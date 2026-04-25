import Foundation
import FirebaseFirestore

/// Reads/writes the per-user `workoutLog` field on `users/{uid}` — the same
/// document/field the web app uses (see `src/utils/firestoreSync.js` →
/// `saveField(uid, 'workoutLog', data)`), so logs sync between platforms.
enum WorkoutFirestoreService {
    private static let db = Firestore.firestore()
    private static let field = "workoutLog"

    static func loadWorkouts(uid: String) async -> [Workout] {
        let ref = db.collection(Constants.firestoreUsersCollection).document(uid)
        do {
            let snapshot = try await ref.getDocument()
            guard let data = snapshot.data(),
                  let raw = data[field] as? [[String: Any]] else { return [] }
            return raw.compactMap(Self.workoutFromDict)
        } catch {
            return []
        }
    }

    static func saveWorkouts(uid: String, workouts: [Workout]) async throws {
        let ref = db.collection(Constants.firestoreUsersCollection).document(uid)
        let payload = workouts.map(Self.workoutToDict)
        try await ref.setData([field: payload], merge: true)
    }

    // MARK: - Serialization

    private static func workoutToDict(_ w: Workout) -> [String: Any] {
        [
            "date": w.date,
            "gym": w.gym,
            "savedAt": w.savedAt,
            "entries": w.entries.map { $0.enriched() },
        ]
    }

    private static func workoutFromDict(_ dict: [String: Any]) -> Workout? {
        guard let date = dict["date"] as? String else { return nil }
        let gym = dict["gym"] as? String ?? "Edge South Tower"
        let savedAt = dict["savedAt"] as? String ?? ""
        let rawEntries = dict["entries"] as? [[String: Any]] ?? []
        let entries: [WorkoutEntry] = rawEntries.map { raw in
            var entry = WorkoutEntry()
            entry.group = raw["group"] as? String ?? ""
            entry.exercise = raw["exercise"] as? String ?? ""
            // Sets may be stored as strings or numbers depending on origin.
            if let sets = raw["sets"] as? [Any] {
                let normalized = sets.map { v -> String in
                    if let s = v as? String { return s }
                    if let n = v as? NSNumber { return n.stringValue }
                    return ""
                }
                entry.sets = Array((normalized + ["", "", "", ""]).prefix(4))
            }
            entry.perArm = raw["perArm"] as? Bool ?? false
            if let w = raw["weight"] as? String {
                entry.weight = w
            } else if let n = raw["weight"] as? NSNumber {
                entry.weight = n.stringValue
            }
            entry.notes = raw["notes"] as? String ?? ""
            entry.time = raw["time"] as? String ?? "2:00"
            return entry
        }
        return Workout(date: date, gym: gym, entries: entries, savedAt: savedAt)
    }
}
