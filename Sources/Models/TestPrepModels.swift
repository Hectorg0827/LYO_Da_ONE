import Foundation

// MARK: - Test Prep wire models
//
// What `/api/v1/me/study_plans/...` actually sends. These replace
// `StudyPlanRecord`, which was removed because it could not have decoded a
// real response: it typed `id` as an `Int` where the wire sends a UUID string,
// and named three fields the server has never returned. Nothing noticed,
// because every call site wrapped the attempt in `try?`.
//
// So each type here was checked against JSON produced by the server's own
// Pydantic models rather than read off the route signatures. Two things that
// catch out a hand-written client, both confirmed that way:
//
//   "scheduled_at": "2026-09-11T22:00:00"   <- no timezone
//   "test_date":    "2026-09-25"            <- a date, not a datetime
//
// `JSONDecoder.lyoDecoder` decodes dates with `ISO8601DateFormatter`, which
// requires a timezone and rejects both. Typing either as `Date` would fail the
// whole response — a correct answer, discarded, reported to the learner as an
// error. They are decoded as strings and parsed leniently below.

/// One of this learner's study plans, as `GET /me/study_plans` lists them.
struct StudyPlanSummary: Codable, Identifiable, Equatable {
    let id: String
    let testProfileId: String
    let status: String
    let createdAt: String
    let totalSessions: Int

    /// Active plans first; an empty list is the normal first state, not an error.
    var isActive: Bool { status == "active" }
}

/// One turn of the intake conversation that builds a test profile.
struct IntakeTurnReply: Codable, Equatable {
    let testProfileId: String
    let messageToUser: String
    let intakeComplete: Bool
}

/// What `POST /plans/generate` answers with.
struct GeneratedPlan: Codable, Equatable {
    let planId: String
    let totalSessions: Int
}

/// One topic of a test and what the learner has shown on it.
struct TopicStanding: Codable, Equatable, Identifiable {
    let topic: String
    /// How the learner's record names this topic. The same key the Classroom
    /// files its evidence under, so a session row and a readiness row can be
    /// matched without either side re-deriving a slug.
    let conceptId: String
    let weight: Double
    /// `nil` means never assessed. That is a different claim from 0.0, which
    /// means measured and nothing demonstrated, and they must not render alike.
    let mastery: Double?
    let attempts: Int

    var id: String { conceptId }
}

/// How ready this learner is for one specific test.
struct PlanReadiness: Codable, Equatable {
    let planId: String
    let subject: String
    /// A calendar date ("2026-09-25"), not a timestamp. See the note above.
    let testDate: String
    /// Negative once the date has passed; `nil` when the profile has no date.
    let daysRemaining: Int?
    /// Weighted 0..1. `nil` only when the profile lists no usable topics.
    let readiness: Double?
    let topicsTotal: Int
    /// Lets the client say "you haven't started yet" rather than "0% ready" —
    /// the same number, a different and crueller claim.
    let topicsAssessed: Int
    let topics: [TopicStanding]
    let focusNext: [String]
}

/// One scheduled study session.
struct PlannedSession: Codable, Equatable, Identifiable {
    let id: String
    /// ISO8601 without a timezone. Parsed by `scheduledDate`, not by the decoder.
    let scheduledAt: String
    let durationMinutes: Int
    let topic: String
    let sessionType: String
    /// Carried by the server so a session can be matched to its standing in
    /// readiness, and so both name the concept the same way.
    let conceptId: String
    let status: String
    let performanceScore: Double?

    /// The server's own words for a session that is done with.
    /// `scheduled` and `in_progress` are the two open states.
    var isOpen: Bool { status != "completed" && status != "skipped" }

    var scheduledDate: Date? { TestPrepDateParsing.parse(scheduledAt) }
}

/// What the server measured for a completed session.
///
/// `performanceScore` is `nil` when nothing was graded. A session spent
/// reading is a real session and the server refuses to invent a figure for it;
/// `nil` here is not zero.
struct SessionOutcome: Codable, Equatable {
    let ok: Bool
    let performanceScore: Double?
    let graded: Int
    let seen: Int
}

// MARK: - Lenient date parsing

enum TestPrepDateParsing {
    /// Parse a timestamp the server may or may not have given a timezone.
    ///
    /// SQLAlchemy stores these naive and Pydantic serialises them as written,
    /// so `scheduled_at` arrives as "2026-09-11T22:00:00" — no offset, no Z.
    /// `ISO8601DateFormatter` rejects that outright, and a rejected date would
    /// fail the decode of an otherwise perfectly good list of sessions.
    ///
    /// A naive timestamp is read as UTC, because that is what the server wrote:
    /// `datetime.utcnow()` throughout the study-plan routes.
    static func parse(_ raw: String) -> Date? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return nil }

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: trimmed) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: trimmed) { return date }

        // No timezone: the common case for this API, not the exception.
        let naive = DateFormatter()
        naive.locale = Locale(identifier: "en_US_POSIX")
        naive.timeZone = TimeZone(identifier: "UTC")
        for format in ["yyyy-MM-dd'T'HH:mm:ss.SSSSSS",
                       "yyyy-MM-dd'T'HH:mm:ss.SSS",
                       "yyyy-MM-dd'T'HH:mm:ss",
                       "yyyy-MM-dd"] {
            naive.dateFormat = format
            if let date = naive.date(from: trimmed) { return date }
        }
        return nil
    }
}
