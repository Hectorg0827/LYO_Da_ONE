import Foundation
import AVFoundation
import NaturalLanguage
import os

/// Live position inside the caption line that is being spoken right now.
///
/// Published by `TextToSpeechService` so a classroom caption can reveal
/// words in step with the audio that is actually playing, instead of
/// showing the whole line the moment the text arrives (neural TTS has to
/// round-trip the network first, so text used to run well ahead of voice).
struct SpokenLineProgress: Equatable {
    /// Caller-supplied identifier for the line (for example a lesson step id).
    let lineId: String
    /// 0...1 share of the line's words that have actually been voiced.
    let revealedFraction: Double
    /// True once audio has really begun playing.
    let started: Bool
    /// True once the line ended, failed, or was skipped by the learner.
    let finished: Bool
}

@MainActor
class TextToSpeechService: NSObject, ObservableObject {
    static let shared = TextToSpeechService()

    @Published var isSpeaking: Bool = false
    /// Word-level progress for the line currently being spoken. `nil` when
    /// nothing tagged with a `lineId` is playing.
    @Published private(set) var lineProgress: SpokenLineProgress?
    var onSpeechFinished: (() -> Void)?

    private let repository: TTSRepository = DefaultTTSRepository()
    private var speechQueue: [(text: String, language: String, lineId: String?)] = []
    private var activeLine: (lineId: String, text: String)?
    private var lineWordStarts: [Double] = []
    private var lineDuration: Double = -1
    private var timeObservation: (player: AVPlayer, token: Any)?
    private var playbackTask: Task<Void, Never>?
    private var player: AVPlayer?
    private var playerItem: AVPlayerItem?
    private var playbackObserver: NSObjectProtocol?
    private var playbackContinuation: CheckedContinuation<Void, Error>?
    private var currentVoice: TTSVoice = .nova
    private var currentSpeed: Double = 0.96
    private let deviceFallbackSynthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        deviceFallbackSynthesizer.delegate = self

        do {
            try configureAudioSession(active: false)
        } catch {
            Log.audio.error("Failed to configure audio session: \(error)")
        }
    }

    func setEmotion(_ emotion: String) {
        switch emotion.lowercased() {
        case "warm":
            currentVoice = .nova
            currentSpeed = 0.94
        case "excited":
            currentVoice = .shimmer
            currentSpeed = 1.02
        case "frustrated":
            currentVoice = .alloy
            currentSpeed = 0.9
        case "confused":
            currentVoice = .nova
            currentSpeed = 0.88
        default:
            currentVoice = .nova
            currentSpeed = 0.96
        }
    }

    /// Speaks `text` after cutting off anything already playing. Pass a
    /// `lineId` to receive word-level `lineProgress` for this line.
    func speak(text: String, language: String = "auto", lineId: String? = nil) {
        stop()
        enqueue(text, language: language, lineId: lineId)
    }

    func enqueue(_ text: String, language: String = "auto", lineId: String? = nil) {
        let cleanText = prepareSpeechText(text)
        guard !cleanText.isEmpty else { return }

        speechQueue.append((cleanText, language, lineId))
        startPlaybackIfNeeded()
    }

    func stop() {
        speechQueue.removeAll()
        playbackTask?.cancel()
        playbackTask = nil
        cancelActivePlayback()
        deviceFallbackSynthesizer.stopSpeaking(at: .immediate)
        isSpeaking = false
        // A skipped line reads as fully spoken: the caption fills in rather
        // than freezing mid-sentence.
        finishActiveLine()

        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            Log.audio.error("Failed to deactivate audio session: \(error)")
        }
    }

    private func startPlaybackIfNeeded() {
        guard playbackTask == nil else { return }

        playbackTask = Task { [weak self] in
            await self?.processQueue()
        }
    }

    private func processQueue() async {
        // A cancelled run must not tear down the run that replaced it:
        // `stop()` followed by `speak()` (Skip, Next) starts a new task
        // before this one has finished unwinding.
        defer { if !Task.isCancelled { playbackTask = nil } }

        while !Task.isCancelled {
            guard !speechQueue.isEmpty else { break }

            let item = speechQueue.removeFirst()
            isSpeaking = true
            beginLine(id: item.lineId, text: item.text)

            do {
                try await playGeneratedSpeech(for: item.text, language: item.language)
            } catch is CancellationError {
                break
            } catch {
                Log.audio.error("Backend TTS playback failed: \(error)")
                guard !Task.isCancelled else { break }
                do {
                    try await playLocalizedDeviceFallback(
                        text: item.text,
                        language: item.language
                    )
                } catch {
                    Log.audio.error("Localized device TTS fallback failed: \(error)")
                }
            }
            finishActiveLine()
        }

        guard !Task.isCancelled else { return }
        let finishedNaturally = speechQueue.isEmpty
        isSpeaking = false
        cleanupPlayer()

        if finishedNaturally {
            onSpeechFinished?()
        }
    }

    private func playGeneratedSpeech(for text: String, language: String) async throws {
        let result = try await repository.generate(
            text: text,
            voice: currentVoice,
            speed: currentSpeed,
            withTimings: false,
            language: language
        )

        guard !Task.isCancelled else { throw CancellationError() }
        guard let url = URL(string: result.audioURL) else {
            throw LyoError.network(.invalidURL)
        }

        defer {
            if url.isFileURL {
                try? FileManager.default.removeItem(at: url)
            }
        }
        try await playAudio(url: url)
    }

    private func playAudio(url: URL) async throws {
        try configureAudioSession(active: true)
        cleanupPlayer(keepSessionActive: true)

        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        player.automaticallyWaitsToMinimizeStalling = true

        self.playerItem = item
        self.player = player
        observePlaybackClock(of: player, item: item)

        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                playbackContinuation = continuation
                playbackObserver = NotificationCenter.default.addObserver(
                    forName: .AVPlayerItemDidPlayToEndTime,
                    object: item,
                    queue: .main
                ) { [weak self] _ in
                    Task { @MainActor [weak self] in
                        self?.resumePlaybackContinuation()
                    }
                }
                player.play()
            }
        }, onCancel: {
            Task { @MainActor [weak self] in
                self?.cancelActivePlayback()
            }
        })

        cleanupPlayer(keepSessionActive: true)
    }

    private func playLocalizedDeviceFallback(
        text: String,
        language: String
    ) async throws {
        let detectedFamily = NLLanguageRecognizer.dominantLanguage(for: text)?.rawValue
        let family = language.lowercased() == "auto"
            ? detectedFamily
            : language.split(separator: "-").first.map(String.init)
        let localeByFamily = [
            "en": "en-US",
            "es": "es-US",
            "fr": "fr-FR",
            "it": "it-IT",
            "pt": "pt-BR",
        ]
        let resolvedLanguage = localeByFamily[family ?? "en"] ?? language
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: resolvedLanguage)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * Float(currentSpeed)
        utterance.pitchMultiplier = 1.0
        try Task.checkCancellation()
        deviceFallbackSynthesizer.speak(utterance)

        do {
            while deviceFallbackSynthesizer.isSpeaking {
                try Task.checkCancellation()
                try await Task.sleep(nanoseconds: 100_000_000)
            }
        } catch {
            deviceFallbackSynthesizer.stopSpeaking(at: .immediate)
            throw error
        }
    }

    private func resumePlaybackContinuation() {
        guard let continuation = playbackContinuation else { return }
        playbackContinuation = nil
        removePlaybackObserver()
        continuation.resume()
    }

    private func cancelActivePlayback() {
        removePlaybackClockObserver()
        player?.pause()
        player = nil
        playerItem = nil

        if let continuation = playbackContinuation {
            playbackContinuation = nil
            removePlaybackObserver()
            continuation.resume(throwing: CancellationError())
        } else {
            removePlaybackObserver()
        }
    }

    private func cleanupPlayer(keepSessionActive: Bool = false) {
        removePlaybackClockObserver()
        player?.pause()
        player = nil
        playerItem = nil
        removePlaybackObserver()

        if !keepSessionActive {
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            } catch {
                Log.audio.error("Failed to deactivate audio session: \(error)")
            }
        }
    }

    private func removePlaybackObserver() {
        if let playbackObserver {
            NotificationCenter.default.removeObserver(playbackObserver)
            self.playbackObserver = nil
        }
    }

    private func configureAudioSession(active: Bool) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers, .allowAirPlay])
        if active {
            try session.setActive(true)
        }
    }

    // MARK: - Caption progress

    private func beginLine(id: String?, text: String) {
        lineWordStarts = []
        lineDuration = -1
        guard let id else {
            activeLine = nil
            lineProgress = nil
            return
        }
        activeLine = (id, text)
        lineProgress = SpokenLineProgress(lineId: id, revealedFraction: 0, started: false, finished: false)
    }

    private func finishActiveLine() {
        guard let line = activeLine else { return }
        activeLine = nil
        lineWordStarts = []
        lineDuration = -1
        lineProgress = SpokenLineProgress(lineId: line.lineId, revealedFraction: 1, started: true, finished: true)
    }

    private func publishLineProgress(fraction: Double, started: Bool) {
        guard let line = activeLine else { return }
        let next = SpokenLineProgress(
            lineId: line.lineId,
            revealedFraction: max(0, min(1, fraction)),
            started: started,
            finished: false
        )
        if next != lineProgress { lineProgress = next }
    }

    /// Neural voice path: follow the media clock of the generated MP3 so
    /// network latency can never let the caption run ahead of the voice.
    private func observePlaybackClock(of player: AVPlayer, item: AVPlayerItem) {
        removePlaybackClockObserver()
        guard activeLine != nil else { return }
        let interval = CMTime(seconds: 0.05, preferredTimescale: 600)
        let token = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self, weak player, weak item] time in
            Task { @MainActor [weak self] in
                guard let self, let player, let item else { return }
                let reported = item.duration.seconds
                self.playbackClockTicked(
                    currentTime: time.seconds,
                    reportedDuration: reported,
                    isPlaying: player.rate > 0
                )
            }
        }
        timeObservation = (player, token)
    }

    private func removePlaybackClockObserver() {
        if let timeObservation {
            timeObservation.player.removeTimeObserver(timeObservation.token)
            self.timeObservation = nil
        }
    }

    private func playbackClockTicked(currentTime: Double, reportedDuration: Double, isPlaying: Bool) {
        guard let line = activeLine, currentTime.isFinite else { return }
        let duration = reportedDuration.isFinite && reportedDuration > 0
            ? reportedDuration
            : SpokenCaptionTiming.estimatedSpeechSeconds(text: line.text, rate: currentSpeed)
        if abs(duration - lineDuration) > 0.02 {
            lineWordStarts = SpokenCaptionTiming.wordStartTimes(text: line.text, durationSeconds: duration)
            lineDuration = duration
        }
        let started = isPlaying || currentTime > 0
        guard started else {
            publishLineProgress(fraction: 0, started: false)
            return
        }
        let totalWords = lineWordStarts.count
        let revealed = SpokenCaptionTiming.revealCount(starts: lineWordStarts, currentTime: currentTime)
        let fraction = totalWords > 0 ? Double(revealed) / Double(totalWords) : 1
        publishLineProgress(fraction: fraction, started: true)
    }

    /// Device voice path: real word-boundary callbacks from the synthesizer.
    private func deviceSpeechReached(characterRange: NSRange, in spokenText: String) {
        guard let line = activeLine, line.text == spokenText else { return }
        let utf16Length = spokenText.utf16.count
        let end = min(utf16Length, characterRange.location + max(characterRange.length, 1))
        let prefix = (spokenText as NSString).substring(to: max(0, end))
        let totalWords = SpokenCaptionTiming.words(in: spokenText).count
        let revealed = max(1, SpokenCaptionTiming.words(in: prefix).count)
        let fraction = totalWords > 0 ? Double(revealed) / Double(totalWords) : 1
        publishLineProgress(fraction: fraction, started: true)
    }

    private func deviceSpeechStarted(_ spokenText: String) {
        guard let line = activeLine, line.text == spokenText else { return }
        publishLineProgress(fraction: lineProgress?.revealedFraction ?? 0, started: true)
    }

    private func prepareSpeechText(_ raw: String) -> String {
        var clean = raw
        clean = clean.replacingOccurrences(of: #"```[\s\S]*?```"#, with: "", options: .regularExpression)
        clean = clean.replacingOccurrences(of: #"#{1,6}\s*"#, with: "", options: .regularExpression)
        clean = clean.replacingOccurrences(of: #"\[(.+?)\]\(.+?\)"#, with: "$1", options: .regularExpression)
        clean = clean.replacingOccurrences(of: #"`(.+?)`"#, with: "$1", options: .regularExpression)
        clean = clean.replacingOccurrences(of: #"\*\*(.+?)\*\*"#, with: "$1", options: .regularExpression)
        clean = clean.replacingOccurrences(of: #"__(.+?)__"#, with: "$1", options: .regularExpression)
        clean = clean.replacingOccurrences(of: #"\*(.+?)\*"#, with: "$1", options: .regularExpression)
        clean = clean.replacingOccurrences(of: #"_(.+?)_"#, with: "$1", options: .regularExpression)
        clean = clean.replacingOccurrences(of: #"(?m)^[\-\*\+]\s+"#, with: "", options: .regularExpression)
        clean = clean.replacingOccurrences(of: #"(?m)^\d+\.\s+"#, with: "", options: .regularExpression)
        clean = clean.replacingOccurrences(of: #"\n+"#, with: " ", options: .regularExpression)
        clean = clean.replacingOccurrences(of: #" {2,}"#, with: " ", options: .regularExpression)
        return clean.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - AVSpeechSynthesizerDelegate

extension TextToSpeechService: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        let spokenText = utterance.speechString
        Task { @MainActor in
            deviceSpeechStarted(spokenText)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        let spokenText = utterance.speechString
        Task { @MainActor in
            deviceSpeechReached(characterRange: characterRange, in: spokenText)
        }
    }
}
