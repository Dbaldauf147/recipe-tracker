import SwiftUI

struct LogWorkoutView: View {
    @ObservedObject var authVM: AuthViewModel
    @StateObject private var vm = WorkoutLogViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                Form {
                    dateAndGymSection
                    ForEach(vm.entries) { entry in
                        entrySection(entry)
                    }
                    addExerciseSection
                    saveSection
                }

                if vm.isLoading {
                    ProgressView("Loading...")
                        .padding()
                        .background(.ultraThinMaterial)
                        .cornerRadius(12)
                }
            }
            .navigationTitle("Log Workout")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Sign Out") { authVM.signOut() }
                        .font(.caption)
                }
            }
            .task { await vm.bootstrap() }
        }
    }

    // MARK: - Sections

    private var dateAndGymSection: some View {
        Section {
            DatePicker(
                "Date",
                selection: Binding(
                    get: { WorkoutLogViewModel.dateFromString(vm.selectedDate) },
                    set: { vm.selectDate(WorkoutLogViewModel.stringFromDate($0)) }
                ),
                displayedComponents: .date
            )
            Picker("Gym", selection: $vm.gym) {
                ForEach(WorkoutCatalog.gyms, id: \.self) { Text($0).tag($0) }
            }
        }
    }

    private func entrySection(_ entry: WorkoutEntry) -> some View {
        Section {
            Picker("Muscle Group", selection: Binding(
                get: { entry.group },
                set: { vm.setGroup($0, for: entry.id) }
            )) {
                Text("Select…").tag("")
                ForEach(WorkoutCatalog.muscleGroups, id: \.self) { Text($0).tag($0) }
            }

            Picker("Exercise", selection: Binding(
                get: { entry.exercise },
                set: { newVal in
                    vm.updateEntry(entry.id) { $0.exercise = newVal }
                }
            )) {
                Text(entry.group.isEmpty ? "Pick a group first" : "Select…").tag("")
                ForEach(WorkoutCatalog.exercisesByGroup[entry.group] ?? [], id: \.self) {
                    Text($0).tag($0)
                }
            }
            .disabled(entry.group.isEmpty)

            HStack(spacing: 8) {
                ForEach(0..<4, id: \.self) { i in
                    setField(entry: entry, setIndex: i)
                }
            }

            HStack {
                Text("Weight")
                TextField("lbs", text: Binding(
                    get: { entry.weight },
                    set: { newVal in vm.updateEntry(entry.id) { $0.weight = newVal } }
                ))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
            }

            Toggle("Per arm", isOn: Binding(
                get: { entry.perArm },
                set: { newVal in vm.updateEntry(entry.id) { $0.perArm = newVal } }
            ))

            TextField(
                "Notes (machine settings, form cues…)",
                text: Binding(
                    get: { entry.notes },
                    set: { newVal in vm.updateEntry(entry.id) { $0.notes = newVal } }
                ),
                axis: .vertical
            )
            .lineLimit(1...3)

            if vm.entries.count > 1 {
                Button(role: .destructive) {
                    vm.removeEntry(id: entry.id)
                } label: {
                    Label("Remove exercise", systemImage: "trash")
                }
            }
        } header: {
            Text(entry.exercise.isEmpty ? "Exercise" : entry.exercise)
        }
    }

    private func setField(entry: WorkoutEntry, setIndex i: Int) -> some View {
        VStack(spacing: 4) {
            Text("Set \(i + 1)")
                .font(.caption2)
                .foregroundColor(.secondary)
            TextField("reps", text: Binding(
                get: { entry.sets.indices.contains(i) ? entry.sets[i] : "" },
                set: { newVal in
                    vm.updateEntry(entry.id) { e in
                        while e.sets.count <= i { e.sets.append("") }
                        e.sets[i] = newVal
                    }
                }
            ))
            .keyboardType(.numberPad)
            .multilineTextAlignment(.center)
            .padding(6)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(6)
        }
    }

    private var addExerciseSection: some View {
        Section {
            Button {
                vm.addEntry()
            } label: {
                Label("Add exercise", systemImage: "plus.circle.fill")
            }
        }
    }

    private var saveSection: some View {
        Section {
            Button {
                Task { await vm.saveWorkout() }
            } label: {
                HStack {
                    Spacer()
                    if vm.saveStatus == .saving {
                        ProgressView()
                    } else {
                        Text("Save Workout").bold()
                    }
                    Spacer()
                }
            }
            .disabled(vm.saveStatus == .saving)

            switch vm.saveStatus {
            case .saved:
                Label("Saved!", systemImage: "checkmark.circle.fill")
                    .foregroundColor(.green)
            case .error(let msg):
                Label(msg, systemImage: "exclamationmark.triangle.fill")
                    .foregroundColor(.red)
            default:
                EmptyView()
            }
        }
    }
}
