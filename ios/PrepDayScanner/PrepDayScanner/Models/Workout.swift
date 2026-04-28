import Foundation

enum WorkoutCatalog {
    static let muscleGroups = [
        "Chest", "Back", "Legs", "Shoulders", "Biceps", "Triceps",
        "Abs", "Forearms", "Cardio", "Yoga", "Whole Body",
    ]

    static let gyms = ["Edge South Tower", "Home", "Other"]

    static let workoutTypes = ["Push", "Pull", "Legs", "Full Body", "Yoga"]

    static let exercisesByGroup: [String: [String]] = [
        "Chest": ["Warm up", "Butterfly", "Cable crossover low to high", "Cable flys declined", "Chest press", "Close grip bench press", "Decline Barbell Press", "Decline press", "Decline push-up", "Dips", "Dumbbell flys", "Dumbbell press", "Dumbbell press inclined", "Dumbbell squeeze press", "Incline press", "Incline push-up", "Inclined Barbell Press", "Inclined machine press", "Inclined smith machine press"],
        "Back": ["Warm up", "Back extensions", "Back extensions - machine", "Bent-over dumbbell row", "Bent-over smith machine row", "Cable lat pullover", "Chin ups", "Face pulls", "Lat pull down (wide grip)", "Lat pull downs (bar)", "Lat pull downs (bar) underhand grip", "Lat pull downs (machine)", "Lat pulldown (vbar grip)", "Middle grip row", "One arm rows", "Plate-loaded low row", "Pull-ups", "Seated cable row", "Seated neutral grip row", "Seated pronated machine row", "Seated vertical row machine", "Single arm cable row", "Single arm lat pulldown", "Standing bent-over dumbbell row", "T bar machine", "Two arm cable row", "Weighted pull-up", "Wide grip row"],
        "Legs": ["Warm up", "Air squats", "Barbell squats", "Bulgarian split squat", "Calf raise", "Curtsey lunges", "Deadlifts", "Dumbbell deadlift", "Glute bridges", "Good mornings", "Hamstring curls", "Hip thrust_barbell", "Jump rope", "Leg extensions", "Leg press", "Leg press calf raise", "Romanian deadlifts - barbell", "Romanian deadlifts - dumbbell", "Seated abductors", "Single leg extension", "Single leg press", "Squats - Barbell", "Squats - Smith machine", "Sumo squat", "Sumo squat cable machine", "Walk", "Wall squats"],
        "Shoulders": ["Warm up", "Arm raises", "Arm raises - Lateral", "Cable lateral raise", "Dumbbell shoulder press", "Face pull", "Shoulder press"],
        "Biceps": ["Warm up", "Bar curls", "Barbell Curls", "Bayesian bicep curl", "Bicep curl", "Bicep curl machine", "Bicep hammer curls", "Hammer rope curls", "Reverse bar bell curls"],
        "Triceps": ["Warm up", "Cable tricep kickback", "Extension", "Seated tricep", "Triangle pushup", "Tricep push down machine", "Tricep pushdown", "Tricep rope pushdowns"],
        "Abs": ["Warm up", "Ab crunch machine", "Ab roller", "Cable crunches", "Cable woodchoppers", "Cable woodchoppers - High to low", "Deadbug", "Dragon flag abs", "Elbow plank", "Hanging leg raise", "Hanging leg raises knees bent", "Hanging leg raises legs straight", "Heel taps", "Kneeling halo", "Leg raises", "Pallof press", "Plank", "Seated cable crunch", "Side bend", "Toe touches"],
        "Forearms": ["Warm up", "Wrist curls", "Reverse wrist curls", "Farmer walks"],
        "Cardio": ["Walk", "Run", "Bike", "Recumbent upright bike", "Jump rope", "Rowing machine", "Elliptical", "Stair climber"],
        "Yoga": ["Yoga flow", "Stretching", "Foam rolling"],
        "Whole Body": ["Warm up", "Circuit training", "HIIT"],
    ]
}

/// One exercise row inside a logged workout day. Mirrors the web app's
/// `entries[]` shape (`group`, `exercise`, `sets[4]`, `weight`, `perArm`,
/// `notes`, `time`) so the same Firestore document is interoperable across
/// platforms.
struct WorkoutEntry: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var group: String = ""
    var exercise: String = ""
    var sets: [String] = ["", "", "", ""]
    var perArm: Bool = false
    var weight: String = ""
    var notes: String = ""
    var time: String = "2:00"

    enum CodingKeys: String, CodingKey {
        case group, exercise, sets, perArm, weight, notes, time
    }

    /// Computed totals stored alongside the entry on save (so other clients
    /// can render stats without recomputing).
    func enriched() -> [String: Any] {
        let reps = sets.compactMap { Double($0) }
        let totalReps = reps.reduce(0, +)
        let maxReps = reps.max() ?? 0
        let avgReps = reps.isEmpty ? 0 : (totalReps / Double(reps.count))
        let w = Double(weight) ?? 0
        let totalWeight = perArm ? w * 2 : w

        return [
            "group": group,
            "exercise": exercise,
            "sets": sets,
            "perArm": perArm,
            "weight": weight,
            "notes": notes,
            "time": time,
            "totalReps": totalReps,
            "maxReps": maxReps,
            "avgReps": (avgReps * 10).rounded() / 10,
            "totalWeight": totalWeight,
            "maxWeight": totalWeight,
        ]
    }
}

struct Workout: Identifiable, Codable, Equatable {
    var id: String { date }
    var date: String           // YYYY-MM-DD
    var gym: String
    var entries: [WorkoutEntry]
    var savedAt: String        // ISO 8601
    var workoutType: String = ""
}
