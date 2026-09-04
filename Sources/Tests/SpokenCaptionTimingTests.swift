import XCTest
@testable import Lyo

final class SpokenCaptionTimingTests: XCTestCase {
    func testWordsDropsEmptyTokens() {
        XCTAssertEqual(SpokenCaptionTiming.words(in: "  Hola,   clase. \n"), ["Hola,", "clase."])
        XCTAssertEqual(SpokenCaptionTiming.words(in: "   "), [])
    }

    func testPunctuationAndLengthMakeAWordTakeLonger() {
        XCTAssertGreaterThan(SpokenCaptionTiming.wordWeight("photosynthesis"), SpokenCaptionTiming.wordWeight("a"))
        XCTAssertGreaterThan(SpokenCaptionTiming.wordWeight("end."), SpokenCaptionTiming.wordWeight("end"))
        XCTAssertGreaterThan(SpokenCaptionTiming.wordWeight("end,"), SpokenCaptionTiming.wordWeight("end"))
        XCTAssertEqual(SpokenCaptionTiming.wordWeight("a"), 0.8, accuracy: 0.0001)
        XCTAssertEqual(SpokenCaptionTiming.wordWeight("aaaaaaaaaaaaaaaaaaaaaaaa"), 2.4, accuracy: 0.0001)
    }

    func testWordStartTimesBeginAtZeroAndStayInsideTheDuration() {
        let starts = SpokenCaptionTiming.wordStartTimes(text: "One two three, four.", durationSeconds: 4)
        XCTAssertEqual(starts.count, 4)
        XCTAssertEqual(starts[0], 0, accuracy: 0.0001)
        for index in 1..<starts.count {
            XCTAssertGreaterThan(starts[index], starts[index - 1])
        }
        XCTAssertLessThan(starts.last ?? 99, 4)
        XCTAssertEqual(SpokenCaptionTiming.wordStartTimes(text: "", durationSeconds: 4), [])
    }

    func testRevealCountFollowsThePlaybackClock() {
        let starts: [Double] = [0, 1, 2, 3]
        XCTAssertEqual(SpokenCaptionTiming.revealCount(starts: starts, currentTime: 0), 1)
        XCTAssertEqual(SpokenCaptionTiming.revealCount(starts: starts, currentTime: 0.99), 2)
        XCTAssertEqual(SpokenCaptionTiming.revealCount(starts: starts, currentTime: 10), 4)
        XCTAssertEqual(SpokenCaptionTiming.revealCount(starts: [], currentTime: 5), 0)
    }

    func testEstimatedDurationScalesWithRateAndNeverCollapses() {
        let sentence = "A fairly ordinary teaching sentence."
        let slow = SpokenCaptionTiming.estimatedSpeechSeconds(text: sentence, rate: 0.8)
        let fast = SpokenCaptionTiming.estimatedSpeechSeconds(text: sentence, rate: 1.4)
        XCTAssertGreaterThan(slow, fast)
        XCTAssertEqual(SpokenCaptionTiming.estimatedSpeechSeconds(text: "", rate: 1), 0.8, accuracy: 0.0001)
    }

    func testCharacterBoundariesMapOntoWords() {
        let text = "Hello brave new world"
        XCTAssertEqual(SpokenCaptionTiming.wordCount(upToCharacterIndex: 0, in: text), 1)
        XCTAssertEqual(SpokenCaptionTiming.wordCount(upToCharacterIndex: 6, in: text), 2)
        XCTAssertEqual(SpokenCaptionTiming.wordCount(upToCharacterIndex: 999, in: text), 4)
        XCTAssertEqual(SpokenCaptionTiming.wordCount(upToCharacterIndex: 3, in: "   "), 0)
    }

    func testFractionsMapOntoTheDisplayedWordCount() {
        XCTAssertEqual(SpokenCaptionTiming.revealedWordCount(fraction: 0, totalWords: 10), 0)
        XCTAssertEqual(SpokenCaptionTiming.revealedWordCount(fraction: 0.5, totalWords: 10), 5)
        XCTAssertEqual(SpokenCaptionTiming.revealedWordCount(fraction: 1.5, totalWords: 10), 10)
        XCTAssertEqual(SpokenCaptionTiming.revealedWordCount(fraction: 0.7, totalWords: 0), 0)
    }
}
