// Representative starter set for the Habits page (Atomic-Habits framework:
// Cue → Craving → Response → Reward). The full ~150-row sheet is best loaded
// via the page's "Paste from spreadsheet" import (copy straight from Google
// Sheets so the tab-separated columns map exactly). These cover each routine
// type so the KPI / Routines / Daily Routine views render with real data.
export const HABIT_FIELDS = [
  { key: 'kpi', label: 'KPI' },
  { key: 'routine', label: 'Routine' },
  { key: 'dailyOrder', label: 'Daily Routine' },
  { key: 'name', label: 'Habit' },
  { key: 'cue', label: 'Cue / Trigger' },
  { key: 'cue2', label: '2nd Cue' },
  { key: 'craving', label: 'Craving' },
  { key: 'response', label: 'Response' },
  { key: 'reward', label: 'Reward' },
  { key: 'age', label: 'Age' },
  { key: 'status', label: 'Status' },
  { key: 'startDate', label: 'Start Date' },
];

const ROWS = [
  ['92%', 'Morning', '1', 'No Snoozing', 'The light turns on', 'Alarm goes off', 'I want to avoid grogginess and wasted time', 'I get out of bed after the light comes on', 'I get to go make coffee', 'Years', 'Automatically', '9/28/2019'],
  ['92%', 'Morning', '2', 'No Morning Social Media', 'Alarm goes off', 'I get woken up by the light', 'I want to not tap into my dopamine yet', 'I get out of bed after the light comes on', 'I have better neurochemistry to enjoy the day', 'Years', 'Automatically', '6/18/2024'],
  ['92%', 'Morning', '7', 'Water before coffee', 'The glass next to the coffee', 'The giant jug', 'I want to be healthy', 'I pour the glass of water', "I dont feel dehydrated anymore", 'Years', 'Automatically', '9/28/2019'],
  ['92%', 'Morning', '12', 'One Morning Coffee', 'When I walk into the kitchen in the morning', 'Coffee machine visible', 'I want to feel awake', 'I make coffee', 'I get a nice hit of energy', 'Years', 'Automatically', '9/28/2019'],
  ['81%', 'Morning', '16', 'Meditation', 'After morning stretch', 'When I sit down at my desk', 'I want to reap all of the scientific benefits of meditation', 'I meditate for 2 minutes', 'I build a strong habit which has been proven to improve my life', 'Years', 'Most Days', '7/31/2021'],
  ['92%', 'Lunch', '23', 'Post Lunch Tea/Coffee', 'Finished lunch', '', "I don't want to get too dependant on caffine", 'After lunch I make tea', "I don't have coffee crash", 'Years', 'Automatically', '9/28/2019'],
  ['83%', 'Lunch', '22', 'No work phone at lunch', 'I leave my desk for lunch', '', 'I need to give my brain a rest', 'I will leave my phone at my desk', 'I get to enjoy disconnecting for lunch', 'Years', 'Automatically', '5/20/2021'],
  ['92%', 'Afternoon', '28', 'No Naps or Coffee After 2PM', 'I see that its past 2 pm', '', 'I want to wake up and focus', 'I avoid coffee', 'I fall asleep relatively easily', 'Years', 'Automatically', '9/28/2019'],
  ['88%', 'Afternoon', '25', 'Daily Reach Out', 'After I shutdown my laptop, I text someone I love', 'I check this sheet and my phone during the day', 'I want to keep in touch with my loved ones', "I go through the list and reach out to someone I havent spoken to in a while", 'I get to catch up with someone I love', 'Years', 'Most Days', '2/1/2021'],
  ['3.02', 'Afternoon', '26', 'Workout', 'After I finish work', '', 'I want to be in good shape', 'I workout', 'Feels great to have exercised', 'Years', 'Automatically', '10/16/2021'],
  ['92%', 'Bedtime', '33', 'Tooth Brushing', '10 PM rolls around', '', 'Desire to have a fresh tasting mouth', 'I brush my teeth', 'My mouth feels better', 'Years', 'Automatically', '9/28/2019'],
  ['92%', 'Bedtime', '35', 'Flossing', 'I finish brushing my tongue', '', 'I want to ensure my teeth are clean', 'I floss', 'I see the stuff come out', 'Years', 'Automatically', '9/28/2019'],
  ['74%', 'Bedtime', '36', 'Gratitude Journaling', 'I get under the covers', '', 'I want to be happy', 'I write down 1 to 3 things that I am grateful for', 'I feel happy', 'Years', 'Some Days', '4/24/2020'],
  ['100%', 'Sunday 1', '100', 'Check Email', 'I finished looking at the calendar', '', 'I want to be up to date on my messages', 'I check my email', 'Seeing the low number feels good', 'Years', 'Automatically', '9/13/2021'],
  ['49%', 'Sunday 7', '105', 'Weekly Grocery Shopping', 'On Sunday prepare meals', '', 'The desire to eat healthy and pescatarian', 'I cook the meals and store them', 'I enjoy being healthy', 'Years', 'Automatically', '4/1/2021'],
  ['100%', 'Monthly 1', '', 'Update Mint Tracker', 'On the last day of the month - A reminder goes off on my phone', '', 'I want to understand my finances', 'I download the Mint data and plug it into my tracker', 'I get to see how much I made/lost', 'Years', 'Automatically', '3/1/2021'],
  ['100%', 'Monthly 2', '', 'Invest Monthly', 'On the last day of the month - A reminder goes off on my phone', '', 'I want to ensure my spare money is working', 'I transfer money to my Robinhood', 'I can review my growth on the monthly account review', 'Years', 'Automatically', '3/31/2021'],
  ['0%', 'Other', '', 'Fork Down Between Bites', 'I take a bite of food', '', 'I want to savor that food', 'I put down my utensils', "I dont over eat and enjoy my food more", 'Years', 'Automatically', '1/15/2021'],
  ['0%', '', '', 'No Social Media in Bed', 'I get into bed', '', 'I dont want to be woken up by that crap', 'I put my phone away from my bed', 'I fall asleep faster', 'Years', 'Abandoned', '9/28/2019'],
];

export function makeHabitId() {
  return 'h-' + Math.random().toString(36).slice(2, 10);
}

export function seedHabits() {
  return ROWS.map(r => {
    const o = { id: makeHabitId() };
    HABIT_FIELDS.forEach((f, i) => { o[f.key] = r[i] || ''; });
    return o;
  });
}
