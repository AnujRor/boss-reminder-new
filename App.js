import { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';

const NAVY = '#1B1F3B';
const SAFFRON = '#FFB020';
const WHITE = '#ffffff';
const INK = '#1B1F3B';
const MUTED = '#6B7280';
const LINE = '#E5E7EB';
const CATEGORY_ID = 'BOSSREMINDER';
const CHANNEL_ID = 'boss_reminder_default';
const STORAGE_KEY = '@boss_reminder_tasks';

const PRIORITY_COLORS = {
  low: '#4CAF50',
  medium: '#FF9800',
  high: '#F44336',
};

const PRIORITY_LABELS = {
  low: 'Kam',
  medium: 'Madhya',
  high: 'Ucha',
};

const CATEGORY_LABELS = {
  work: 'Kam',
  personal: 'Niji',
  other: 'Anyatha',
};

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [permissionStatus, setPermissionStatus] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerValue, setPickerValue] = useState(new Date());
  const [taskText, setTaskText] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');
  const [taskCategory, setTaskCategory] = useState('work');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('pending');
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editPickerValue, setEditPickerValue] = useState(new Date());
  const [editPriority, setEditPriority] = useState('medium');
  const [editCategory, setEditCategory] = useState('work');
  const [showEditPicker, setShowEditPicker] = useState(false);

  const formatDateLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const formatHM12 = (date) => {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatHM24 = (date) => {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  const parseTaskDateTime = (task) => {
    return new Date(`${task.date}T${task.time}:00`);
  };

  const isTaskPast = (task) => {
    if (task.done) return false;
    return parseTaskDateTime(task) < new Date();
  };

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  const saveTasks = useCallback(async (list) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
  }, []);

  const setupNotifications = useCallback(async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Boss Reminder',
        importance: Notifications.AndroidImportance.MAX,
        sound: './assets/notification.wav',
        vibrationPattern: [0, 250, 250, 250],
        lightColor: SAFFRON,
        enableVibrate: true,
        enableLights: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        showBadge: true,
      });
    }

    await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
      { identifier: 'DONE', buttonTitle: 'Ho gaya' },
      { identifier: 'SNOOZE', buttonTitle: '10 min baad' },
    ]);
  }, []);

  const scheduleTaskNotification = useCallback(async (task) => {
    try {
      await Notifications.cancelScheduledNotificationAsync(task.id);
    } catch {}
    const triggerDate = parseTaskDateTime(task);
    const time12 = formatHM12(triggerDate);
    const id = await Notifications.scheduleNotificationAsync({
      identifier: task.id,
      content: {
        title: 'Boss, kaam ka time ho gaya!',
        body: `${time12} ho gaye hain. ${task.text} ka time ho gaya hai.`,
        sound: true,
        vibrate: [0, 250, 250, 250],
        priority: 'high',
        color: SAFFRON,
        categoryIdentifier: CATEGORY_ID,
        data: {
          taskId: task.id,
          time: time12,
          text: task.text,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        delivery: 'alarmClock',
      },
    });
    return id;
  }, [formatHM12]);

  const rescheduleAll = useCallback(async () => {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {}
    const pending = tasks.filter((t) => !t.done);
    for (const task of pending) {
      try {
        await scheduleTaskNotification(task);
      } catch {}
    }
  }, [tasks, scheduleTaskNotification]);

  const speakNotificationText = (time, text) => {
    Speech.speak(`Boss! ${time} ho gaye hain. ${text} ka time ho gaya hai.`, {
      language: 'hi-IN',
    });
  };

  const handleNotificationReceived = (notification) => {
    const data = notification.request.content.data || {};
    speakNotificationText(data.time, data.text);
  };

  const handleNotificationResponse = (response) => {
    const notification = response.notification;
    const data = notification.request.content.data || {};
    const { actionIdentifier } = response;
    const taskId = data.taskId;

    speakNotificationText(data.time, data.text);

    if (actionIdentifier === 'DONE' && taskId) {
      const next = tasks.map((t) => (t.id === taskId ? { ...t, done: true } : t));
      setTasks(next);
      saveTasks(next);
      try {
        await Notifications.cancelScheduledNotificationAsync(taskId);
      } catch {}
    } else if (actionIdentifier === 'SNOOZE' && taskId) {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const d = parseTaskDateTime(task);
      d.setMinutes(d.getMinutes() + 10);
      const updated = { ...task, time: formatHM24(d), date: formatDateLocal(d), done: false };
      const next = tasks.map((t) => (t.id === taskId ? updated : t));
      setTasks(next);
      await saveTasks(next);
      await rescheduleAll();
    }
  };

  const markDone = useCallback(async (taskId) => {
    const next = tasks.map((t) => (t.id === taskId ? { ...t, done: true } : t));
    setTasks(next);
    await saveTasks(next);
    try {
      await Notifications.cancelScheduledNotificationAsync(taskId);
    } catch {}
  }, [tasks, saveTasks]);

  const snooze = useCallback(async (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const d = parseTaskDateTime(task);
    d.setMinutes(d.getMinutes() + 10);
    const updated = { ...task, time: formatHM24(d), date: formatDateLocal(d), done: false };
    const next = tasks.map((t) => (t.id === taskId ? updated : t));
    setTasks(next);
    await saveTasks(next);
    await rescheduleAll();
  }, [tasks, formatHM24, formatDateLocal, saveTasks, rescheduleAll]);

  const deleteTask = useCallback(async (taskId) => {
    try {
      await Notifications.cancelScheduledNotificationAsync(taskId);
    } catch {}
    const next = tasks.filter((t) => t.id !== taskId);
    setTasks(next);
    await saveTasks(next);
  }, [tasks, saveTasks]);

  const clearAllCompleted = useCallback(async () => {
    const completed = tasks.filter((t) => t.done);
    for (const t of completed) {
      try {
        await Notifications.cancelScheduledNotificationAsync(t.id);
      } catch {}
    }
    const next = tasks.filter((t) => !t.done);
    setTasks(next);
    await saveTasks(next);
    showToast('Sab poore hue tasks delete kar diye gaye.');
  }, [tasks, saveTasks]);

  const initApp = useCallback(async () => {
    try {
      await setupNotifications();
      const status = await Notifications.getPermissionsAsync();
      setPermissionStatus(status.granted);
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      let loaded = [];
      if (stored) {
        try {
          loaded = JSON.parse(stored);
        } catch {}
      }
      const today = formatDateLocal(new Date());
      loaded = loaded.filter((t) => t.date >= today);
      setTasks(loaded);
      await rescheduleAll();

      try {
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        if (lastResponse) {
          handleNotificationResponse(lastResponse);
        }
      } catch {}
    } catch {}
    setLoading(false);
  }, [setupNotifications, formatDateLocal, rescheduleAll, handleNotificationResponse]);

  useEffect(() => {
    initApp();
    const sub1 = Notifications.addNotificationReceivedListener(handleNotificationReceived);
    const sub2 = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, [initApp, handleNotificationReceived, handleNotificationResponse]);

  const requestPermission = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setPermissionStatus(status === 'granted');
      if (status === 'granted') {
        await setupNotifications();
        await rescheduleAll();
        showToast('Permission mil gaya hai.');
      } else {
        showToast('Notification permission chahiye. Phone ki Settings mein jaye aur Boss Reminder notifications on karein.');
      }
    } catch {}
  };

  const addTask = async () => {
    const text = taskText.trim();
    if (!text) return;
    const chosenDate = formatDateLocal(pickerValue);
    const time = formatHM24(pickerValue);
    const today = formatDateLocal(new Date());
    let date = chosenDate;
    let message = null;
    if (chosenDate === today) {
      const chosen = new Date(`${today}T${time}:00`);
      if (chosen <= new Date()) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        date = formatDateLocal(tomorrow);
        message = 'Chuna hua time nikal chuka hai, isliye kal ke liye set kiya gaya hai.';
      }
    }
    const newTask = { id: String(Date.now()), text, time, date, done: false, priority: taskPriority, category: taskCategory };
    const next = [...tasks, newTask];
    setTasks(next);
    setTaskText('');
    setShowPicker(false);
    await saveTasks(next);
    await rescheduleAll();
    if (message) showToast(message);
    else showToast('Task jod liya gaya hai.');
  };

  const handleDateTimePickerChange = (event, selected) => {
    setShowPicker(false);
    if (selected) setPickerValue(selected);
  };

  const handleEditDateTimePickerChange = (event, selected) => {
    setShowEditPicker(false);
    if (selected) setEditPickerValue(selected);
  };

  const startEdit = (task) => {
    setEditingTaskId(task.id);
    setEditText(task.text);
    setEditPriority(task.priority || 'medium');
    setEditCategory(task.category || 'work');
    const dt = new Date(`${task.date}T${task.time}:00`);
    setEditPickerValue(dt);
    setShowEditPicker(false);
  };

  const cancelEdit = () => {
    setEditingTaskId(null);
    setEditText('');
    setEditPriority('medium');
    setEditCategory('work');
    setShowEditPicker(false);
  };

  const saveEdit = async () => {
    const text = editText.trim();
    if (!text) return;
    const date = formatDateLocal(editPickerValue);
    const time = formatHM24(editPickerValue);
    const today = formatDateLocal(new Date());
    if (date === today) {
      const chosen = new Date(`${today}T${time}:00`);
      if (chosen <= new Date()) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(editPickerValue.getHours(), editPickerValue.getMinutes(), 0, 0);
        setEditPickerValue(tomorrow);
      }
    }
    const updated = {
      ...tasks.find((t) => t.id === editingTaskId),
      text,
      time,
      date,
      priority: editPriority,
      category: editCategory,
      done: false,
    };
    const next = tasks.map((t) => (t.id === editingTaskId ? updated : t));
    setTasks(next);
    setEditingTaskId(null);
    setEditText('');
    setEditPriority('medium');
    setEditCategory('work');
    await saveTasks(next);
    await rescheduleAll();
    showToast('Task update kar diya gaya hai.');
  };

  const speakTask = (task) => {
    const dt = parseTaskDateTime(task);
    Speech.speak(`${task.text}. ${formatHM12(dt)} ka time hai.`, {
      language: 'hi-IN',
    });
  };

  const testReminder = async () => {
    const d = new Date(Date.now() + 10 * 1000);
    const time12 = formatHM12(d);
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: 'test-' + Date.now(),
        content: {
          title: 'Boss, kaam ka time ho gaya!',
          body: `Test reminder: ${time12} ho gaye hain.`,
          sound: true,
          vibrate: [0, 250, 250, 250],
          priority: 'high',
          color: SAFFRON,
          categoryIdentifier: CATEGORY_ID,
        },
        trigger: { type: 'timeInterval', seconds: 10, repeats: false },
        delivery: 'alarmClock',
      });
    } catch {}
    Speech.speak('Boss! Test reminder 10 second baad aayega.', { language: 'hi-IN' });
    showToast('Test reminder set kar diya hai (10 second baad).');
  };

  const filteredTasks = tasks
    .filter((t) => activeTab === 'pending' ? !t.done : t.done)
    .filter((t) => t.text.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => parseTaskDateTime(a) - parseTaskDateTime(b));

  const pendingCount = tasks.filter((t) => !t.done).length;

  const renderItem = ({ item }) => {
    const past = isTaskPast(item);
    const dt = parseTaskDateTime(item);
    const time12 = formatHM12(dt);
    const priorityColor = PRIORITY_COLORS[item.priority || 'medium'] || '#FF9800';
    return (
      <View style={[styles.card, past && styles.pastCard, item.done && styles.doneCard]}>
        <View style={styles.itemRow}>
          <View style={styles.timeCol}>
            <View style={styles.priorityDotContainer}>
              <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
            </View>
            <Text style={[styles.timeText, past && styles.pastText]}>{time12}</Text>
            <Text style={[styles.metaText, past && styles.pastText]}>{item.date}</Text>
          </View>
          <View style={styles.taskCol}>
            <TouchableOpacity style={styles.taskTouch} onPress={() => startEdit(item)}>
              <Text style={[styles.taskText, item.done && styles.doneText, past && styles.pastText]}>
                {item.done ? item.text + ' (Ho gaya)' : item.text}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.categoryText, past && styles.pastText]}>
              {CATEGORY_LABELS[item.category || 'work']} \u00b7 {PRIORITY_LABELS[item.priority || 'medium']}
            </Text>
          </View>
          <View style={styles.actionCol}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => speakTask(item)}>
              <Text style={styles.iconText}>🔊</Text>
            </TouchableOpacity>
            {item.done ? (
              <TouchableOpacity style={[styles.iconBtn, styles.deleteBtn]} onPress={() => deleteTask(item.id)}>
                <Text style={styles.deleteText}>🗑️</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity style={styles.iconBtn} onPress={() => markDone(item.id)}>
                  <Text style={styles.doneIconText}>✅</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.iconBtn, styles.deleteBtn]} onPress={() => deleteTask(item.id)}>
                  <Text style={styles.deleteText}>🗑️</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor={NAVY} />
      <View style={styles.header}>
        <View style={styles.accentLine} />
        <Text style={styles.headerTitle}>Boss Reminder</Text>
        <Text style={styles.headerSub}>
          {pendingCount} pending \u00b7 Subah ka task, waqt par yaad dilayenge
        </Text>
      </View>

      {permissionStatus === null && (
        <View style={[styles.card, styles.permCard]}>
          <Text style={styles.permTitle}>Notifications on karein</Text>
          <Text style={styles.permMsg}>
            Boss Reminder ko waqt par notification dikhane ke liye notification permission chahiye.
          </Text>
          <TouchableOpacity style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Permission mangaoin</Text>
          </TouchableOpacity>
        </View>
      )}

      {permissionStatus === false && (
        <View style={[styles.card, styles.permCard, styles.permDenied]}>
          <Text style={[styles.permTitle, styles.permDeniedTitle]}>Notification permission nahi mila</Text>
          <Text style={[styles.permMsg, styles.permDeniedMsg]}>
            Kripya apne phone ki Settings mein jaye, Apps > Boss Reminder > Notifications par jaye aur notifications ON karein.
          </Text>
          <TouchableOpacity style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Dobara koshish karein</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Task search karein..."
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'pending' && styles.tabActive]} onPress={() => setActiveTab('pending')}>
          <Text style={[styles.tabText, activeTab === 'pending' && styles.tabTextActive]}>Pending</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'completed' && styles.tabActive]} onPress={() => setActiveTab('completed')}>
          <Text style={[styles.tabText, activeTab === 'completed' && styles.tabTextActive]}>Poore hue</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'position' : undefined} style={styles.inputWrapper}>
        <View style={styles.addCard}>
          <TextInput
            style={styles.input}
            value={taskText}
            onChangeText={setTaskText}
            placeholder="Kaam ka naam likhein..."
            placeholderTextColor="#9CA3AF"
          />
          <TouchableOpacity style={styles.timeButton} onPress={() => setShowPicker(true)}>
            <Text style={styles.timeButtonText}>
              {formatHM12(pickerValue)} {formatDateLocal(pickerValue)}
            </Text>
          </TouchableOpacity>
          <View style={styles.priorityRow}>
            <Text style={styles.priorityLabel}>Priority:</Text>
            <View style={styles.prioritySelector}>
              {['low', 'medium', 'high'].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.priorityChip, taskPriority === p && styles.priorityChipActive]}
                  onPress={() => setTaskPriority(p)}
                >
                  <Text style={[styles.priorityChipText, taskPriority === p && styles.priorityChipTextActive]}>
                    {PRIORITY_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.categoryRow}>
            <Text style={styles.categoryLabel}>Category:</Text>
            <View style={styles.categorySelector}>
              {['work', 'personal', 'other'].map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.categoryChip, taskCategory === c && styles.categoryChipActive]}
                  onPress={() => setTaskCategory(c)}
                >
                  <Text style={[styles.categoryChipText, taskCategory === c && styles.categoryChipTextActive]}>
                    {CATEGORY_LABELS[c]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <TouchableOpacity style={styles.addButton} onPress={addTask}>
            <Text style={styles.addButtonText}>Task jodein</Text>
          </TouchableOpacity>
        </View>
        {showPicker && (
          <DateTimePicker
            value={pickerValue}
            mode="time"
            display="spinner"
            onChange={handleDateTimePickerChange}
          />
        )}
      </KeyboardAvoidingView>

      {editingTaskId && (
        <View style={styles.editCard}>
          <Text style={styles.editTitle}>Task edit karein</Text>
          <TextInput
            style={styles.editInput}
            value={editText}
            onChangeText={setEditText}
            placeholder="Kaam ka naam likhein..."
            placeholderTextColor="#9CA3AF"
          />
          <TouchableOpacity style={styles.editTimeButton} onPress={() => setShowEditPicker(true)}>
            <Text style={styles.editTimeButtonText}>
              {formatHM12(editPickerValue)} {formatDateLocal(editPickerValue)}
            </Text>
          </TouchableOpacity>
          <View style={styles.editPriorityRow}>
            <Text style={styles.editPriorityLabel}>Priority:</Text>
            <View style={styles.editPrioritySelector}>
              {['low', 'medium', 'high'].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.editPriorityChip, editPriority === p && styles.editPriorityChipActive]}
                  onPress={() => setEditPriority(p)}
                >
                  <Text style={[styles.editPriorityChipText, editPriority === p && styles.editPriorityChipTextActive]}>
                    {PRIORITY_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.editActions}>
            <TouchableOpacity style={styles.editCancelButton} onPress={cancelEdit}>
              <Text style={styles.editCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editSaveButton} onPress={saveEdit}>
              <Text style={styles.editSaveText}>Save karein</Text>
            </TouchableOpacity>
          </View>
        </View>
        {showEditPicker && (
          <DateTimePicker
            value={editPickerValue}
            mode="time"
            display="spinner"
            onChange={handleEditDateTimePickerChange}
          />
        )}
      )}

      <TouchableOpacity style={styles.testButton} onPress={testReminder}>
        <Text style={styles.testButtonText}>⚠️ 10 second test reminder</Text>
      </TouchableOpacity>

      {activeTab === 'pending' && tasks.some((t) => t.done) && (
        <TouchableOpacity style={styles.clearButton} onPress={clearAllCompleted}>
          <Text style={styles.clearText}>Sab poore hue tasks delete karein</Text>
        </TouchableOpacity>
      )}

      {toast && <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View>}

      <View style={styles.listContainer}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator size="small" color={SAFFRON} /></View>
        ) : filteredTasks.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>
              {activeTab === 'pending' ? 'Abhi koi pending task nahi hai. Naya task jodein.' : 'Koi poora hua task nahi hai.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredTasks}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            extraData={tasks}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  header: {
    backgroundColor: NAVY,
    paddingTop: 56,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  accentLine: {
    height: 4,
    width: 56,
    backgroundColor: SAFFRON,
    marginBottom: 12,
    borderRadius: 2,
  },
  headerTitle: {
    color: WHITE,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerSub: {
    color: '#CBD3E2',
    fontSize: 14,
    marginTop: 4,
  },
  card: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  permCard: {
    marginTop: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: SAFFRON,
  },
  permDenied: {
    borderLeftColor: '#EF4444',
  },
  permTitle: {
    color: INK,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  permDeniedTitle: {
    color: '#B91C1C',
  },
  permMsg: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },
  permDeniedMsg: {
    color: '#7F1D1D',
  },
  button: {
    backgroundColor: SAFFRON,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: NAVY,
    fontSize: 15,
    fontWeight: '700',
  },
  searchContainer: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  searchInput: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: INK,
    fontSize: 15,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 12,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: SAFFRON,
  },
  tabText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: NAVY,
    fontWeight: '800',
  },
  inputWrapper: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  addCard: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    marginBottom: 10,
  },
  input: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: INK,
    fontSize: 16,
    marginBottom: 10,
  },
  timeButton: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    minWidth: 150,
    marginBottom: 10,
  },
  timeButtonText: {
    color: INK,
    fontSize: 15,
    fontWeight: '600',
  },
  priorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  priorityLabel: {
    color: MUTED,
    fontSize: 13,
    marginRight: 8,
    fontWeight: '600',
  },
  prioritySelector: {
    flexDirection: 'row',
    gap: 6,
  },
  priorityChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: WHITE,
  },
  priorityChipActive: {
    backgroundColor: SAFFRON,
    borderColor: SAFFRON,
  },
  priorityChipText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  priorityChipTextActive: {
    color: NAVY,
    fontWeight: '800',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  categoryLabel: {
    color: MUTED,
    fontSize: 13,
    marginRight: 8,
    fontWeight: '600',
  },
  categorySelector: {
    flexDirection: 'row',
    gap: 6,
  },
  categoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: WHITE,
  },
  categoryChipActive: {
    backgroundColor: SAFFRON,
    borderColor: SAFFRON,
  },
  categoryChipText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: NAVY,
    fontWeight: '800',
  },
  addButton: {
    backgroundColor: SAFFRON,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  addButtonText: {
    color: NAVY,
    fontSize: 15,
    fontWeight: '800',
  },
  editCard: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  editTitle: {
    color: INK,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
  },
  editInput: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: INK,
    fontSize: 16,
    marginBottom: 10,
  },
  editTimeButton: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    minWidth: 150,
    marginBottom: 10,
  },
  editTimeButtonText: {
    color: INK,
    fontSize: 15,
    fontWeight: '600',
  },
  editPriorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  editPriorityLabel: {
    color: MUTED,
    fontSize: 13,
    marginRight: 8,
    fontWeight: '600',
  },
  editPrioritySelector: {
    flexDirection: 'row',
    gap: 6,
  },
  editPriorityChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: WHITE,
  },
  editPriorityChipActive: {
    backgroundColor: SAFFRON,
    borderColor: SAFFRON,
  },
  editPriorityChipText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  editPriorityChipTextActive: {
    color: NAVY,
    fontWeight: '800',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  editCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: LINE,
  },
  editCancelText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
  editSaveButton: {
    backgroundColor: SAFFRON,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  editSaveText: {
    color: NAVY,
    fontSize: 14,
    fontWeight: '700',
  },
  testButton: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 12,
    alignSelf: 'center',
    width: 260,
    paddingVertical: 11,
    alignItems: 'center',
    marginVertical: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  testButtonText: {
    color: SAFFRON,
    fontSize: 15,
    fontWeight: '700',
  },
  clearButton: {
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
  },
  clearText: {
    color: '#B91C1C',
    fontSize: 14,
    fontWeight: '700',
  },
  toast: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    backgroundColor: INK,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  toastText: {
    color: WHITE,
    fontSize: 14,
    fontWeight: '600',
  },
  listContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  listContent: {
    paddingBottom: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: MUTED,
    fontSize: 16,
  },
  pastCard: {
    opacity: 0.55,
  },
  doneCard: {
    backgroundColor: '#F1F5F9',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  timeCol: {
    minWidth: 78,
  },
  priorityDotContainer: {
    marginBottom: 4,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timeText: {
    color: INK,
    fontSize: 20,
    fontWeight: '800',
  },
  pastText: {
    color: '#9CA3AF',
  },
  metaText: {
    color: MUTED,
    fontSize: 12,
    marginTop: 2,
  },
  taskCol: {
    flex: 1,
    marginHorizontal: 12,
  },
  taskTouch: {
    alignItems: 'flex-start',
  },
  taskText: {
    color: INK,
    fontSize: 16,
    fontWeight: '600',
  },
  doneText: {
    textDecorationLine: 'line-through',
    color: MUTED,
  },
  categoryText: {
    color: MUTED,
    fontSize: 12,
    marginTop: 2,
  },
  actionCol: {
    flexDirection: 'row',
    gap: 6,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    backgroundColor: '#FEE2E2',
  },
  iconText: {
    fontSize: 18,
    color: INK,
  },
  doneIconText: {
    fontSize: 18,
    color: '#4CAF50',
  },
  deleteText: {
    fontSize: 18,
    color: '#B91C1C',
  },
});
