import Foundation
import FirebaseAuth

@MainActor
final class WorkoutLogViewModel: ObservableObject {
    @Published var workouts: [Workout] = []
    @Published var selectedDate: String = WorkoutLogViewModel.todayString()
    @Published var gym: String = WorkoutCatalog.gyms[0]
    @Published var entries: [WorkoutEntry] = [WorkoutEntry()]
    @Published var isLoading: Bool = false
    @Published var saveStatus: SaveStatus = .idle

    enum SaveStatus: Equatable {
        case idle
        case saving
        case saved
        case error(String)
    }

    func bootstrap() async {
        guard let uid = Auth.auth().currentUser?.uid else { return }
        isLoading = true
        let loaded = await WorkoutFirestoreService.loadWorkouts(uid: uid)
        workouts = loaded.sorted { $0.date > $1.date }
        loadEntries(for: selectedDate)
        isLoading = false
    }

    func selectDate(_ date: String) {
        selectedDate = date
        loadEntries(for: date)
    }

    private func loadEntries(for date: String) {
        if let existing = workouts.first(where: { $0.date == date }) {
            gym = existing.gym
            entries = existing.entries.isEmpty ? [WorkoutEntry()] : existing.entries
        } else {
            entries = [WorkoutEntry()]
        }
    }

    func addEntry() {
        entries.append(WorkoutEntry())
    }

    func removeEntry(id: UUID) {
        entries.removeAll { $0.id == id }
        if entries.isEmpty { entries.append(WorkoutEntry()) }
    }

    func setGroup(_ group: String, for entryId: UUID) {
        guard let idx = entries.firstIndex(where: { $0.id == entryId }) else { return }
        entries[idx].group = group
        // Reset exercise — exercise list depends on group.
        entries[idx].exercise = ""
    }

    func updateEntry(_ entryId: UUID, mutate: (inout WorkoutEntry) -> Void) {
        guard let idx = entries.firstIndex(where: { $0.id == entryId }) else { return }
        mutate(&entries[idx])
    }

    func saveWorkout() async {
        guard let uid = Auth.auth().currentUser?.uid else {
            saveStatus = .error("Not signed in")
            return
        }
        let valid = entries.filter { !$0.group.isEmpty && !$0.exercise.isEmpty }
        guard !valid.isEmpty else {
            saveStatus = .error("Pick a muscle group and exercise first.")
            return
        }
        saveStatus = .saving

        let workout = Workout(
            date: selectedDate,
            gym: gym,
            entries: valid,
            savedAt: ISO8601DateFormatter().string(from: Date())
        )

        var next = workouts.filter { $0.date != selectedDate }
        next.append(workout)
        next.sort { $0.date > $1.date }

        do {
            try await WorkoutFirestoreService.saveWorkouts(uid: uid, workouts: next)
            workouts = next
            saveStatus = .saved
        } catch {
            saveStatus = .error(error.localizedDescription)
        }
    }

    // MARK: - Helpers

    static func todayString() -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    static func dateFromString(_ s: String) -> Date {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: s) ?? Date()
    }

    static func stringFromDate(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}
