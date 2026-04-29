import SwiftUI

struct LogWorkoutView: View {
    @ObservedObject var authVM: AuthViewModel
    @StateObject private var vm = WorkoutLogViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                List {
                    dateAndGymSection
                    ForEach(vm.entries) { entry in
                        entrySection(entry)
                    }
                    addExerciseSection
                    saveSection
                }
                .listStyle(.insetGrouped)

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
            Picker("Workout Type", selection: $vm.workoutType) {
                Text("None").tag("")
                ForEach(WorkoutCatalog.workoutTypes, id: \.self) { Text($0).tag($0) }
            }
        }
    }

    private func entrySection(_ entry: WorkoutEntry) -> some View {
        Section {
            TabView {
                entryMainPage(entry).tag(0)
                entryDetailPage(entry).tag(1)
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))
            .frame(height: 360)
            .listRowInsets(EdgeInsets())
        } header: {
            HStack {
                Text(entry.exercise.isEmpty ? "Exercise" : entry.exercise)
                Spacer()
                Image(systemName: "arrow.left.arrow.right")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                Text("swipe for notes")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .textCase(.lowercase)
            }
        }
    }

    @ViewBuilder
    private func entryMainPage(_ entry: WorkoutEntry) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Muscle Group").font(.subheadline)
                Spacer()
                Picker("Muscle Group", selection: Binding(
                    get: { entry.group },
                    set: { vm.setGroup($0, for: entry.id) }
                )) {
                    Text("Select…").tag("")
                    ForEach(WorkoutCatalog.muscleGroups, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden()
                .pickerStyle(.menu)
            }

            HStack {
                Text("Exercise").font(.subheadline)
                Spacer()
                Picker("Exercise", selection: Binding(
                    get: { entry.exercise },
                    set: { newVal in vm.updateEntry(entry.id) { $0.exercise = newVal } }
                )) {
                    Text(entry.group.isEmpty ? "Pick a group first" : "Select…").tag("")
                    ForEach(WorkoutCatalog.exercisesByGroup[entry.group] ?? [], id: \.self) {
                        Text($0).tag($0)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .disabled(entry.group.isEmpty)
            }

            HStack(spacing: 8) {
                ForEach(0..<4, id: \.self) { i in
                    setField(entry: entry, setIndex: i)
                }
            }

            HStack {
                Text("Weight").font(.subheadline)
                Spacer()
                TextField("lbs", text: Binding(
                    get: { entry.weight },
                    set: { newVal in vm.updateEntry(entry.id) { $0.weight = newVal } }
                ))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 110)
            }

            Toggle("Per arm", isOn: Binding(
                get: { entry.perArm },
                set: { newVal in vm.updateEntry(entry.id) { $0.perArm = newVal } }
            ))
            .font(.subheadline)

            if vm.entries.count > 1 {
                Button(role: .destructive) {
                    vm.removeEntry(id: entry.id)
                } label: {
                    Label("Remove exercise", systemImage: "trash")
                        .font(.footnote)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 28) // leave room for page dots
    }

    @ViewBuilder
    private func entryDetailPage(_ entry: WorkoutEntry) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Notes")
                    .font(.subheadline.weight(.semibold))
                TextField(
                    "Machine settings, form cues…",
                    text: Binding(
                        get: { entry.notes },
                        set: { newVal in vm.updateEntry(entry.id) { $0.notes = newVal } }
                    ),
                    axis: .vertical
                )
                .lineLimit(3...8)
                .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Videos")
                    .font(.subheadline.weight(.semibold))
                Text("No videos linked for this exercise yet.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 28)
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
