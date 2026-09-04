import Foundation

/// Word-level timing for a spoken caption.
///
/// Mirrors the web classroom's `ClassroomCaptionSync` maths so the three
/// clients reveal a caption at the same pace against the same audio:
/// longer words take longer, punctuation adds a natural pause, and the
/// reveal is driven by the *real* playback clock rather than by when the
/// text arrived from the server.
enum SpokenCaptionTiming {

    /// Whitespace-separated tokens, empty tokens removed.
    static func words(in text: String) -> [String] {
        text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).map(String.init)
    }

    /// Relative time a single word takes to say. Same curve as the web
    /// client: 0.8...2.4 by spoken length, plus pauses for punctuation.
    static func wordWeight(_ word: String) -> Double {
        let spokenLength = word.unicodeScalars.filter { scalar in
            CharacterSet.letters.contains(scalar) || CharacterSet.decimalDigits.contains(scalar)
        }.count
        var weight = max(0.8, min(2.4, Double(spokenLength) / 4.5))
        if let last = word.last {
            if ",;:".contains(last) { weight += 0.65 }
            if ".!?".contains(last) { weight += 1.05 }
        }
        return weight
    }

    /// Start offset (seconds) of every word when `text` is spread over
    /// `durationSeconds` of audio.
    static func wordStartTimes(text: String, durationSeconds: Double) -> [Double] {
        let tokens = words(in: text)
        guard !tokens.isEmpty else { return [] }
        let weights = tokens.map(wordWeight)
        let totalWeight = max(weights.reduce(0, +), 1)
        var elapsedWeight = 0.0
        return weights.map { weight in
            let start = (elapsedWeight / totalWeight) * durationSeconds
            elapsedWeight += weight
            return start
        }
    }

    /// How many words have started by `currentTime`, with the same 25 ms
    /// lookahead the web ticker uses so a word never lands late.
    static func revealCount(starts: [Double], currentTime: Double) -> Int {
        var count = 0
        while count < starts.count, currentTime + 0.025 >= starts[count] {
            count += 1
        }
        return count
    }

    /// Estimated audio length when the player has not reported a duration
    /// yet (or for device speech, which never does). ~205 words per minute
    /// at 1x, scaled by the speech rate.
    static func estimatedSpeechSeconds(text: String, rate: Double) -> Double {
        let weighted = words(in: text).reduce(0.0) { $0 + wordWeight($1) }
        return max(0.8, (weighted * 60) / (205 * max(rate, 0.5)))
    }

    /// Number of words that are fully or partly spoken once the engine has
    /// reached `characterIndex` (from a speech-boundary callback).
    static func wordCount(upToCharacterIndex characterIndex: Int, in text: String) -> Int {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return 0 }
        let clamped = max(0, min(characterIndex + 1, text.count))
        let prefix = String(text.prefix(clamped))
        return max(1, words(in: prefix).count)
    }

    /// Maps a 0...1 spoken fraction onto a different rendering of the same
    /// line (the display text keeps its markdown, the spoken text does not,
    /// so their word counts can differ slightly).
    static func revealedWordCount(fraction: Double, totalWords: Int) -> Int {
        guard totalWords > 0 else { return 0 }
        let clamped = max(0, min(1, fraction))
        return Int((clamped * Double(totalWords)).rounded())
    }
}
