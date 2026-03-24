import React, { useState, useEffect, useMemo } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, ScrollView, 
  SafeAreaView, Modal, Alert, Platform, KeyboardAvoidingView,
  useColorScheme as useSystemColorScheme, LogBox, StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LayoutDashboard, Library, Settings as SettingsIcon, Plus, Box, Search,
  ChevronRight, PlusCircle, MinusCircle, Trash2, Save, X,
  Layers, MapPin, Tag, Hash, ExternalLink, ChevronDown,
  Sparkles, Filter, Clock, ArrowRight, BookOpen, AlertCircle,
  Download, Upload, Moon, Sun, Smartphone, CheckSquare, Square, Bell
} from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

// --- FileSystem のインポート (legacy互換API) ---
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useColorScheme } from 'nativewind';
import * as Notifications from 'expo-notifications';

// 内部警告を画面に出さないようにする
LogBox.ignoreLogs([
  'AsyncStorageError',
  'Native module is null'
]);

// --- Constants: Presets ---
const PRESET_TEMPLATES = [
  {
    name: "冷蔵庫",
    subLocations: ["上段", "中段", "下段", "チルド室", "野菜室", "ドアポケット"],
    attributes: [{ name: "賞味期限", type: "date" }, { name: "メモ", type: "text" }]
  },
  {
    name: "引き出し・棚",
    subLocations: ["1段目", "2段目", "3段目", "4段目", "天板"],
    attributes: [{ name: "カテゴリ", type: "tag" }, { name: "備考", type: "text" }]
  },
  {
    name: "商品在庫",
    subLocations: ["出品待ち", "出品中", "発送済み", "保管箱A", "保管箱B"],
    attributes: [
      { name: "仕入れ価格", type: "number" }, { name: "仕入れ日", type: "date" },
      { name: "商品URL", type: "url" }, { name: "JANコード", type: "number" }
    ]
  },
  {
    name: "本棚",
    subLocations: ["最上段", "2段目", "3段目", "4段目", "最下段", "未整理"],
    attributes: [
      { name: "著者名", type: "text" }, { name: "出版社", type: "text" },
      { name: "カテゴリ", type: "tag" }, { name: "読了日", type: "date" }
    ]
  },
  {
    name: "デジタル資産",
    subLocations: ["クラウド", "ローカルドライブ", "外付けHDD", "サブスク"],
    attributes: [
      { name: "ログインID", type: "text" }, { name: "関連URL", type: "url" },
      { name: "更新日", type: "date" }
    ]
  },
  {
    name: "買い物リスト",
    subLocations: ["スーパー", "コンビニ", "ドラッグストア", "ホームセンター", "ネット"],
    attributes: [
      { name: "購入済み", type: "checkbox" },
      { name: "数量", type: "number" },
      { name: "予算(円)", type: "number" },
      { name: "メモ", type: "text" }
    ]
  }
];

const generateId = () => Math.random().toString(36).substring(2, 11);

// --- Custom Components ---
const CustomSelect = ({ value, options, onChange, placeholder = "選択してください" }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <TouchableOpacity 
        onPress={() => setIsOpen(true)}
        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-3 flex-row items-center justify-between"
      >
        <Text className="text-sm font-bold text-slate-800 dark:text-slate-200">{value || placeholder}</Text>
        <ChevronDown size={16} color="#94a3b8" />
      </TouchableOpacity>
      <Modal visible={isOpen} transparent animationType="fade">
        <TouchableOpacity 
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}
          activeOpacity={1} onPress={() => setIsOpen(false)}
        >
          <View className="bg-white dark:bg-slate-800 rounded-3xl overflow-hidden max-h-[70%]">
            <ScrollView>
              {options.map((opt, i) => (
                <TouchableOpacity 
                  key={i} onPress={() => { onChange(opt.value || opt); setIsOpen(false); }}
                  className="p-4 border-b border-slate-100 dark:border-slate-700"
                >
                  <Text className={`text-center text-base ${value === (opt.value || opt) ? 'font-bold text-amber-600' : 'text-slate-700 dark:text-slate-300'}`}>
                    {opt.label || opt}
                  </Text>
                </TouchableOpacity>
              ))}
              {options.length === 0 && <View className="p-4"><Text className="text-center font-bold text-slate-400">オプションなし</Text></View>}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

// --- Main App Component ---
export default function App() {
  const { colorScheme, setColorScheme } = useColorScheme();
  const systemColorScheme = useSystemColorScheme();
  
  const [activeTab, setActiveTab] = useState('dashboard');
  const [templates, setTemplates] = useState([]);
  const [items, setItems] = useState([]);
  
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [itemToEdit, setItemToEdit] = useState(null);
  const [templateToEdit, setTemplateToEdit] = useState(null);
  const [isAddingTemplate, setIsAddingTemplate] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplateFilter, setSelectedTemplateFilter] = useState('all');
  const [activeAttributeFilter, setActiveAttributeFilter] = useState(null);
  
  const [showPresets, setShowPresets] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [themeSetting, setThemeSetting] = useState('system');

  // --- Push Notification Setup ---
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowAlert: true,
    }),
  });

  const requestNotificationPermission = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  };

  const scheduleExpiryNotification = async (itemName: string, dateValue: string) => {
    const expiry = new Date(dateValue);
    if (isNaN(expiry.getTime())) return;
    // 期限3日前の9時に通知
    const notifyAt = new Date(expiry);
    notifyAt.setDate(notifyAt.getDate() - 3);
    notifyAt.setHours(9, 0, 0, 0);
    if (notifyAt <= new Date()) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⏰ もうすぐ期限切れ',
        body: `「${itemName}」の期限まであと3日です`,
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: notifyAt },
    });
  };

  // Initialization & Load Data
  useEffect(() => {
    const loadData = async () => {
      let parsedTemplates = [];
      let tutorialDone = false;
      try {
        const storedTemplates = await AsyncStorage.getItem('@tresor_templates');
        const storedItems = await AsyncStorage.getItem('@tresor_items');
        tutorialDone = await AsyncStorage.getItem('@tresor_tutorial_done');
        const savedTheme = await AsyncStorage.getItem('@tresor_theme');

        if (savedTheme) {
          setThemeSetting(savedTheme);
          setColorScheme(savedTheme === 'system' ? systemColorScheme : savedTheme);
        }

        parsedTemplates = storedTemplates ? JSON.parse(storedTemplates) : [];
        setTemplates(parsedTemplates);
        setItems(storedItems ? JSON.parse(storedItems) : []);
      } catch (err) {
        console.log("Load Error", err);
      }

      if (!tutorialDone && parsedTemplates.length === 0) {
        setShowTutorial(true);
      }
      // 通知パーミッションをリクエスト
      await requestNotificationPermission();
    };
    loadData();
  }, [systemColorScheme]);

  // Derived States
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchTemp = selectedTemplateFilter === 'all' || item.templateId === selectedTemplateFilter;
      let matchAttr = true;
      if (activeAttributeFilter) {
        matchAttr = item.attributes?.[activeAttributeFilter.key] === activeAttributeFilter.value;
      }
      return matchSearch && matchTemp && matchAttr;
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [items, searchQuery, selectedTemplateFilter, activeAttributeFilter]);

  const alertItems = useMemo(() => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const soon = new Date();
    soon.setDate(today.getDate() + 7);

    return items.filter(item => {
      if (!item.attributes) return false;
      return Object.values(item.attributes).some(val => {
        const d = new Date(val);
        return !isNaN(d) && d >= today && d <= soon;
      });
    }).slice(0, 3);
  }, [items]);

  const recentItems = useMemo(() => items.slice(0, 4), [items]);

  // Data Persistence Actions
  const saveToStorage = async (key, data) => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
      console.log("Save Storage Error", err);
    }
  };

  const handleSaveItem = async (itemData) => {
    let newItems = itemToEdit
      ? items.map(i => i.id === itemToEdit.id ? { ...i, ...itemData, updatedAt: Date.now() } : i)
      : [{ ...itemData, id: generateId(), createdAt: Date.now(), updatedAt: Date.now() }, ...items];

    setItems(newItems);
    await saveToStorage('@tresor_items', newItems);

    // 日付属性に対してプッシュ通知をスケジュール
    if (itemData.attributes) {
      const granted = await requestNotificationPermission();
      if (granted) {
        for (const [, val] of Object.entries(itemData.attributes)) {
          if (typeof val === 'string' && !isNaN(new Date(val).getTime()) && val.includes('-')) {
            await scheduleExpiryNotification(itemData.name, val);
          }
        }
      }
    }

    setIsAddingItem(false);
    setItemToEdit(null);
  };

  const handleSaveTemplate = async (templateData) => {
    let newTemplates = templateToEdit
      ? templates.map(t => t.id === templateToEdit.id ? { ...t, ...templateData, updatedAt: Date.now() } : t)
      : [...templates, { ...templateData, id: generateId(), createdAt: Date.now() }];
    
    setTemplates(newTemplates);
    await saveToStorage('@tresor_templates', newTemplates);
    setTemplateToEdit(null); 
    setIsAddingTemplate(false); 
    setShowPresets(false);
  };

  const handleDeleteTemplate = (id) => {
    Alert.alert("確認", "このテンプレートを削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      { text: "削除", style: "destructive", onPress: async () => {
          const newTemplates = templates.filter(t => t.id !== id);
          setTemplates(newTemplates);
          await saveToStorage('@tresor_templates', newTemplates);
          setTemplateToEdit(null); 
          setIsAddingTemplate(false);
        }
      }
    ]);
  };

  const deleteItem = (id) => {
    Alert.alert("確認", "アイテムを削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      { text: "削除", style: "destructive", onPress: async () => {
          const newItems = items.filter(i => i.id !== id);
          setItems(newItems); 
          await saveToStorage('@tresor_items', newItems);
          setIsAddingItem(false); 
          setItemToEdit(null);
        }
      }
    ]);
  };

  const updateQuantity = async (id, delta) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const newQty = Math.max(0, (Number(item.quantity) || 0) + delta);
    const updatedItems = items.map(i => 
      i.id === id ? { ...i, quantity: newQty, updatedAt: Date.now() } : i
    );
    setItems(updatedItems);
    await saveToStorage('@tresor_items', updatedItems);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 5) return "夜更かしですか？";
    if (hour < 11) return "おはようございます";
    if (hour < 17) return "こんにちは";
    return "こんばんは";
  };

  // --- CSV Export / Import ---
  const handleExportData = async () => {
    try {
      const exportObject = { templates, items };
      const csvContent = `data_type,json_payload\ntresor_backup,${JSON.stringify(exportObject).replace(/"/g, '""')}`;
      const fileUri = `${FileSystem.documentDirectory}tresor_backup.csv`;
      
      await FileSystem.writeAsStringAsync(fileUri, csvContent);
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert("エラー", "この端末ではファイル共有がサポートされていません。");
      }
    } catch (err) { 
      Alert.alert("エクスポート失敗", "ファイル処理中にエラーが発生しました。\n" + err.message); 
    }
  };

  const handleImportData = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
      if (result.canceled) return;
      
      const fileContent = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = fileContent.split('\n');
      
      if (rows.length < 2 || !rows[1].startsWith('tresor_backup,')) {
        throw new Error("無効なバックアップファイルです。");
      }
      
      const jsonString = rows[1].substring('tresor_backup,'.length).replace(/""/g, '"');
      const importedData = JSON.parse(jsonString);
      
      if (importedData.templates && importedData.items) {
        Alert.alert("インポート確認", "現在のデータはすべて上書きされます。よろしいですか？", [
          { text: "キャンセル", style: "cancel" },
          { text: "実行", style: "destructive", onPress: async () => {
              setTemplates(importedData.templates); setItems(importedData.items);
              await saveToStorage('@tresor_templates', importedData.templates);
              await saveToStorage('@tresor_items', importedData.items);
              Alert.alert("完了", "データを復元しました。");
            }
          }
        ]);
      }
    } catch (err) { 
      Alert.alert("インポート失敗", "形式が正しいか確認してください。"); 
    }
  };

  const handleResetData = () => {
    Alert.alert("🚨 全データリセット", "登録したアイテムとテンプレートがすべて削除されます。元に戻せません。本当に実行しますか？", [
      { text: "キャンセル", style: "cancel" },
      { text: "すべて削除する", style: "destructive", onPress: async () => {
          setTemplates([]); setItems([]);
          try {
            await AsyncStorage.removeItem('@tresor_templates'); 
            await AsyncStorage.removeItem('@tresor_items');
          } catch(e) {}
          Alert.alert("完了", "データを初期化しました。");
        }
      }
    ]);
  };

  const changeTheme = async (mode) => {
    setThemeSetting(mode);
    setColorScheme(mode === 'system' ? systemColorScheme : mode);
    try {
      await AsyncStorage.setItem('@tresor_theme', mode);
    } catch (e) { console.log(e); }
  };

  // --- Tab Navigation Component ---
  const SidebarItem = ({ id, icon: Icon, label }) => (
    <TouchableOpacity activeOpacity={0.7} onPress={() => setActiveTab(id)} className="flex-1 items-center justify-center py-3">
      <Icon size={24} color={activeTab === id ? '#d97706' : '#94a3b8'} />
      <Text className={`text-[10px] mt-1 font-bold ${activeTab === id ? 'text-amber-600' : 'text-slate-400'}`}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
      <View style={{ paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 }}>
        <View className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex-row items-center justify-between z-10">
          <Text className="text-xl font-bold text-amber-500 italic">trésor</Text>
          <TouchableOpacity onPress={() => setShowTutorial(true)} className="p-2">
            <BookOpen size={20} color="#94a3b8" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 100 }}>
        
        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <View style={{ gap: 32 }}>
            <View>
              <Text className="text-2xl font-bold text-slate-800 dark:text-white">{getGreeting()}</Text>
              <Text className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-bold">現在の管理状況をお知らせします。</Text>
            </View>
            
            <View className="flex-row" style={{ gap: 16 }}>
              <View className="flex-1 bg-white dark:bg-slate-800 p-5 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 h-32 justify-between overflow-hidden shadow-sm">
                <Box size={24} color="#f59e0b" />
                <View>
                  <Text className="text-3xl font-black text-slate-800 dark:text-white leading-none">{items.length}</Text>
                  <Text className="text-[10px] font-bold text-slate-400 mt-1">アイテム総数</Text>
                </View>
              </View>
              <View className="flex-1 bg-white dark:bg-slate-800 p-5 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 h-32 justify-between overflow-hidden shadow-sm">
                <Layers size={24} color="#94a3b8" />
                <View>
                  <Text className="text-3xl font-black text-slate-800 dark:text-white leading-none">{templates.length}</Text>
                  <Text className="text-[10px] font-bold text-slate-400 mt-1">テンプレート</Text>
                </View>
              </View>
            </View>

            {templates.length === 0 && (
              <View className="bg-amber-500 p-6 rounded-[2.5rem] shadow-sm overflow-hidden" style={{ gap: 16 }}>
                <View className="absolute -right-2 -top-2 opacity-20"><Sparkles size={80} color="white" /></View>
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <Sparkles size={20} color="white" />
                  <Text className="text-lg font-bold text-white">使い方はかんたんです！</Text>
                </View>
                <View style={{ gap: 12 }}>
                  <View className="flex-row items-center" style={{ gap: 12 }}>
                    <View className="w-6 h-6 bg-white/30 rounded-full items-center justify-center"><Text className="text-xs font-bold text-white">1</Text></View>
                    <Text className="text-sm font-bold text-white">「テンプレート」で型を作る</Text>
                  </View>
                  <View className="flex-row items-center" style={{ gap: 12 }}>
                    <View className="w-6 h-6 bg-white/30 rounded-full items-center justify-center"><Text className="text-xs font-bold text-white">2</Text></View>
                    <Text className="text-sm font-bold text-white">「ライブラリ」から登録する</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setShowTutorial(true)} className="w-full bg-white py-3 rounded-2xl items-center shadow-sm">
                  <Text className="text-amber-600 font-bold text-sm">はじめてガイドを見る</Text>
                </TouchableOpacity>
              </View>
            )}

            {alertItems.length > 0 && (
              <View style={{ gap: 12 }}>
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <AlertCircle size={18} color="#d97706" />
                  <Text className="font-bold text-xs text-amber-600">期限間近のアラート</Text>
                </View>
                <View style={{ gap: 8 }}>
                  {alertItems.map(item => (
                    <TouchableOpacity 
                      key={item.id} onPress={() => { setItemToEdit(item); setIsAddingItem(true); }}
                      className="bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-900/50 p-3 rounded-2xl flex-row items-center justify-between"
                    >
                      <View className="flex-row items-center flex-1" style={{ gap: 12 }}>
                        <View className="w-8 h-8 bg-white dark:bg-slate-800 rounded-xl items-center justify-center shadow-sm"><Clock size={16} color="#f59e0b" /></View>
                        <Text className="text-sm font-bold text-amber-900 dark:text-amber-400 flex-1" numberOfLines={1}>{item.name}</Text>
                      </View>
                      <ChevronRight size={16} color="#fcd34d" />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <View style={{ gap: 16 }}>
              <View className="flex-row items-center justify-between">
                <Text className="font-bold text-[10px] text-slate-400">最近のアクティビティ</Text>
                <TouchableOpacity onPress={() => setActiveTab('library')} className="flex-row items-center" style={{ gap: 4 }}>
                  <Text className="text-amber-600 text-[10px] font-bold">すべて見る</Text>
                  <ArrowRight size={12} color="#d97706" />
                </TouchableOpacity>
              </View>
              <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                {recentItems.map(item => (
                  <TouchableOpacity 
                    key={item.id} onPress={() => { setItemToEdit(item); setIsAddingItem(true); }}
                    className="bg-white dark:bg-slate-800 p-4 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm"
                    style={{ width: '48%' }}
                  >
                    <View className="w-10 h-10 bg-slate-50 dark:bg-slate-700 rounded-2xl items-center justify-center mb-3"><Box size={20} color="#cbd5e1" /></View>
                    <Text className="font-bold text-slate-800 dark:text-white text-sm" numberOfLines={2}>{item.name}</Text>
                    <Text className="text-[10px] font-bold text-slate-400 mt-2" numberOfLines={1}>
                      {templates.find(t => t.id === item.templateId)?.name || '未分類'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* LIBRARY TAB */}
        {activeTab === 'library' && (
          <View style={{ gap: 16 }}>
            <View className="relative justify-center">
              <View className="absolute left-3 z-10"><Search size={18} color="#94a3b8" /></View>
              <TextInput
                placeholder="名称で検索..." placeholderTextColor="#94a3b8"
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-10 pr-4 text-sm font-bold dark:text-white"
                value={searchQuery} onChangeText={setSearchQuery}
              />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              <TouchableOpacity
                onPress={() => setSelectedTemplateFilter('all')}
                className={`px-4 py-2 rounded-full border ${selectedTemplateFilter === 'all' ? 'bg-amber-600 border-amber-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
              >
                <Text className={`text-xs font-bold ${selectedTemplateFilter === 'all' ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>すべて</Text>
              </TouchableOpacity>
              {templates.map(t => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setSelectedTemplateFilter(t.id)}
                  className={`px-4 py-2 rounded-full border ${selectedTemplateFilter === t.id ? 'bg-amber-600 border-amber-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                  <Text className={`text-xs font-bold ${selectedTemplateFilter === t.id ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{t.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {activeAttributeFilter && (
              <View className="flex-row items-center bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-900/50 px-3 py-2 rounded-xl">
                <Filter size={14} color="#f59e0b" />
                <Text className="text-xs font-bold text-amber-800 dark:text-amber-400 ml-2 flex-1" numberOfLines={1}>絞り込み中: {activeAttributeFilter.value}</Text>
                <TouchableOpacity onPress={() => setActiveAttributeFilter(null)} className="ml-2">
                  <X size={14} color="#d97706" />
                </TouchableOpacity>
              </View>
            )}

            <View style={{ gap: 12 }}>
              {filteredItems.map(item => (
                <TouchableOpacity 
                  key={item.id} activeOpacity={0.8}
                  onPress={() => { setItemToEdit(item); setIsAddingItem(true); }}
                  className="bg-white dark:bg-slate-800 p-4 rounded-[2rem] shadow-sm border border-slate-100 dark:border-slate-700"
                >
                  <View className="flex-row items-start" style={{ gap: 16 }}>
                    <View className="w-12 h-12 bg-slate-50 dark:bg-slate-700 rounded-2xl items-center justify-center"><Box size={24} color="#cbd5e1" /></View>
                    <View className="flex-1 justify-center py-1">
                      <View className="flex-row items-center justify-between">
                        <Text className="font-bold text-slate-800 dark:text-white text-sm flex-1" numberOfLines={2}>{item.name}</Text>
                      </View>
                      <View className="flex-row flex-wrap items-center mt-1.5" style={{ gap: 8 }}>
                        <View className="bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-md">
                          <Text className="text-[10px] text-slate-500 dark:text-slate-300 font-bold">{templates.find(t => t.id === item.templateId)?.name || '未分類'}</Text>
                        </View>
                        {item.subLocation ? (
                          <View className="flex-row items-center" style={{ gap: 4 }}>
                            <MapPin size={10} color="#d97706" />
                            <Text className="text-[10px] text-amber-600 font-bold">{item.subLocation}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    <View className="flex-row items-center bg-slate-50 dark:bg-slate-700 rounded-2xl p-1 self-center ml-2">
                      <TouchableOpacity onPress={() => updateQuantity(item.id, -1)} className="p-1">
                        <MinusCircle size={18} color="#94a3b8" />
                      </TouchableOpacity>
                      <Text className="w-6 text-center font-bold text-sm text-slate-800 dark:text-white">{item.quantity || 0}</Text>
                      <TouchableOpacity onPress={() => updateQuantity(item.id, 1)} className="p-1">
                        <PlusCircle size={18} color="#94a3b8" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {item.attributes && Object.keys(item.attributes).length > 0 && (
                    <View className="flex-row flex-wrap border-t border-slate-50 dark:border-slate-700 pt-3 mt-3" style={{ gap: 8 }}>
                      {Object.entries(item.attributes).map(([key, val]) => {
                        if (!val && val !== 'false') return null;
                        const isCheckbox = val === 'true' || val === 'false';
                        const isTag = !isCheckbox && (val.toString().startsWith('#') || key.toLowerCase().includes('タグ'));
                        const isUrl = !isCheckbox && val.toString().startsWith('http');
                        if (isCheckbox) {
                          return (
                            <View key={key} className="px-2 py-1.5 rounded-lg flex-row items-center bg-slate-50 dark:bg-slate-700" style={{ gap: 4 }}>
                              {val === 'true'
                                ? <CheckSquare size={10} color="#d97706" />
                                : <Square size={10} color="#94a3b8" />
                              }
                              <Text className={`text-[10px] font-bold ${val === 'true' ? 'text-amber-600' : 'text-slate-400'}`}>
                                {key}
                              </Text>
                            </View>
                          );
                        }
                        return (
                          <TouchableOpacity
                            key={key}
                            onPress={() => setActiveAttributeFilter({ key, value: val })}
                            className={`px-2 py-1.5 rounded-lg flex-row items-center ${
                              isTag ? 'bg-amber-100 dark:bg-amber-900/30' : isUrl ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-slate-50 dark:bg-slate-700'
                            }`}
                            style={{ gap: 4 }}
                          >
                            {isTag ? <Hash size={9} color="#b45309" /> : isUrl ? <ExternalLink size={9} color="#2563eb" /> : <Tag size={9} color="#64748b" />}
                            <Text className={`text-[10px] font-bold ${isTag ? 'text-amber-700 dark:text-amber-400' : isUrl ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-300'}`}>
                              {val}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </TouchableOpacity>
              ))}
              {filteredItems.length === 0 && (
                <View className="items-center justify-center py-20" style={{ gap: 8 }}>
                  <Library size={48} color="#cbd5e1" strokeWidth={1} />
                  <Text className="text-sm font-bold text-slate-300 mt-2">アイテムが見つかりませんでした</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* TEMPLATES TAB */}
        {activeTab === 'templates' && (
          <View style={{ gap: 24 }}>
            <View className="flex-row justify-between items-center px-1">
              <Text className="text-lg font-bold text-slate-800 dark:text-white">テンプレート管理</Text>
              <View className="flex-row" style={{ gap: 8 }}>
                <TouchableOpacity onPress={() => setShowPresets(true)} className="bg-white dark:bg-slate-800 border border-amber-200 px-3 py-2 rounded-xl flex-row items-center" style={{ gap: 4 }}>
                  <Sparkles size={14} color="#d97706" />
                  <Text className="text-amber-600 text-xs font-bold">プリセット</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setTemplateToEdit(null); setIsAddingTemplate(true); }} className="bg-amber-600 px-3 py-2 rounded-xl flex-row items-center shadow-sm" style={{ gap: 4 }}>
                  <Plus size={14} color="white" />
                  <Text className="text-white text-xs font-bold">作成</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ gap: 12 }}>
              {templates.map(t => (
                <TouchableOpacity 
                  key={t.id} onPress={() => { setTemplateToEdit(t); setIsAddingTemplate(true); }} 
                  className="bg-white dark:bg-slate-800 p-4 rounded-3xl border border-slate-100 dark:border-slate-700 flex-row items-center justify-between"
                >
                  <View className="flex-row items-center flex-1" style={{ gap: 12 }}>
                    <View className="p-2.5 bg-amber-50 dark:bg-slate-700 rounded-2xl"><Layers size={20} color="#d97706" /></View>
                    <View className="flex-1">
                      <Text className="font-bold text-slate-800 dark:text-white text-base" numberOfLines={1}>{t.name}</Text>
                      <Text className="text-[10px] text-slate-400 font-bold mt-1">{t.subLocations?.length || 0} 階層 / {t.attributes?.length || 0} 属性</Text>
                    </View>
                  </View>
                  <ChevronRight size={18} color="#cbd5e1" />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <View style={{ gap: 32 }}>
            <Text className="text-2xl font-bold text-slate-800 dark:text-white">設定</Text>
            
            <View style={{ gap: 12 }}>
              <Text className="text-xs font-bold text-slate-400 ml-2">テーマ設定</Text>
              <View className="bg-white dark:bg-slate-800 rounded-3xl overflow-hidden border border-slate-100 dark:border-slate-700">
                <TouchableOpacity onPress={() => changeTheme('light')} className="flex-row items-center justify-between p-4 border-b border-slate-100 dark:border-slate-700">
                  <View className="flex-row items-center" style={{ gap: 12 }}><Sun size={20} color="#64748b" /><Text className="font-bold text-slate-700 dark:text-slate-200">ライトモード</Text></View>
                  {themeSetting === 'light' && <View className="w-3 h-3 rounded-full bg-amber-500" />}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => changeTheme('dark')} className="flex-row items-center justify-between p-4 border-b border-slate-100 dark:border-slate-700">
                  <View className="flex-row items-center" style={{ gap: 12 }}><Moon size={20} color="#64748b" /><Text className="font-bold text-slate-700 dark:text-slate-200">ダークモード</Text></View>
                  {themeSetting === 'dark' && <View className="w-3 h-3 rounded-full bg-amber-500" />}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => changeTheme('system')} className="flex-row items-center justify-between p-4">
                  <View className="flex-row items-center" style={{ gap: 12 }}><Smartphone size={20} color="#64748b" /><Text className="font-bold text-slate-700 dark:text-slate-200">端末の設定に従う</Text></View>
                  {themeSetting === 'system' && <View className="w-3 h-3 rounded-full bg-amber-500" />}
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ gap: 12 }}>
              <Text className="text-xs font-bold text-slate-400 ml-2">データ管理 (バックアップ)</Text>
              <View className="bg-white dark:bg-slate-800 rounded-3xl overflow-hidden border border-slate-100 dark:border-slate-700">
                <TouchableOpacity onPress={handleExportData} className="flex-row items-center p-4 border-b border-slate-100 dark:border-slate-700">
                  <Download size={20} color="#d97706" />
                  <Text className="font-bold text-slate-700 dark:text-slate-200 ml-3">CSVバックアップを出力</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleImportData} className="flex-row items-center p-4">
                  <Upload size={20} color="#0284c7" />
                  <Text className="font-bold text-slate-700 dark:text-slate-200 ml-3">CSVファイルから復元</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ marginTop: 16 }}>
              <TouchableOpacity onPress={handleResetData} className="bg-red-50 dark:bg-red-900/30 rounded-3xl flex-row items-center p-4 border border-red-100 dark:border-red-900">
                <Trash2 size={20} color="#ef4444" />
                <Text className="font-bold text-red-500 ml-3">全データをリセット</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Floating Action Button */}
      {activeTab === 'library' && (
        <TouchableOpacity 
          onPress={() => { setItemToEdit(null); setIsAddingItem(true); }} 
          className="absolute right-6 bottom-24 w-14 h-14 bg-amber-600 rounded-full shadow-lg items-center justify-center z-20"
        >
          <Plus size={28} color="white" />
        </TouchableOpacity>
      )}

      {/* Navigation Bar */}
      <View className="absolute bottom-0 left-0 right-0 bg-white/95 dark:bg-slate-900/95 border-t border-slate-200 dark:border-slate-800 flex-row justify-around items-center px-4 pb-6 pt-2 z-10">
        <SidebarItem id="dashboard" icon={LayoutDashboard} label="ホーム" />
        <SidebarItem id="library" icon={Library} label="ライブラリ" />
        <SidebarItem id="templates" icon={Layers} label="テンプレート" />
        <SidebarItem id="settings" icon={SettingsIcon} label="設定" />
      </View>

      {/* Modals */}
      {showTutorial && <TutorialModal onClose={() => { setShowTutorial(false); saveToStorage('@tresor_tutorial_done', 'true'); }} />}
      {isAddingItem && <ItemEditorModal item={itemToEdit} templates={templates} onClose={() => setIsAddingItem(false)} onSave={handleSaveItem} onDelete={deleteItem} colorScheme={colorScheme} />}
      {isAddingTemplate && <TemplateEditorModal template={templateToEdit} onClose={() => setIsAddingTemplate(false)} onSave={handleSaveTemplate} onDelete={handleDeleteTemplate} />}
      {showPresets && <PresetSelectionModal onClose={() => setShowPresets(false)} onSelect={handleSaveTemplate} />}
    </SafeAreaView>
  );
}

// --- Tutorial Modal ---
function TutorialModal({ onClose }) {
  const [step, setStep] = useState(0);
  const steps = [
    { title: "trésor（トレゾール）へようこそ", desc: "身の回りのあらゆるモノを「あなた専用の型」で管理できる魔法の宝箱です。", icon: <Sparkles color="#f59e0b" size={48} /> },
    { title: "1. テンプレート（型）を作る", desc: "「テンプレート」タブから、管理したいモノの型を作ります。項目を自由に決められます。", icon: <Layers color="#f59e0b" size={48} /> },
    { title: "2. モノを登録する", desc: "「ライブラリ」から、モノを登録します。型を選ぶだけで、最適な入力欄が現れます。", icon: <PlusCircle color="#f59e0b" size={48} /> },
    { title: "3. タグで賢く整理", desc: "「#仕事」などのタグを付けると、一覧からワンタップで絞り込めます。", icon: <Hash color="#f59e0b" size={48} /> }
  ];

  return (
    <Modal transparent animationType="slide">
      <View className="flex-1 bg-slate-900/60 justify-center items-center p-4">
        <View className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[3rem] p-8 shadow-xl" style={{ gap: 24 }}>
          <View className="items-center py-4">{steps[step].icon}</View>
          <View style={{ gap: 8 }}>
            <Text className="text-xl font-black text-slate-800 dark:text-white text-center">{steps[step].title}</Text>
            <Text className="text-sm text-slate-500 dark:text-slate-400 text-center leading-relaxed">{steps[step].desc}</Text>
          </View>
          <View className="flex-row justify-center pt-4" style={{ gap: 8 }}>
            {steps.map((_, i) => (<View key={i} className={`h-1.5 rounded-full ${i === step ? 'w-8 bg-amber-500' : 'w-2 bg-slate-200 dark:bg-slate-700'}`} />))}
          </View>
          <View className="flex-row pt-4" style={{ gap: 16 }}>
            {step > 0 && (
              <TouchableOpacity onPress={() => setStep(step - 1)} className="flex-1 bg-slate-100 dark:bg-slate-800 py-3.5 rounded-2xl items-center">
                <Text className="font-bold text-slate-600 dark:text-slate-300">戻る</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => { if (step < steps.length - 1) setStep(step + 1); else onClose(); }} className="flex-1 bg-amber-600 py-3.5 rounded-2xl items-center shadow-sm">
              <Text className="font-bold text-white">{step < steps.length - 1 ? "次へ" : "はじめる！"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// --- Item Editor Modal ---
function ItemEditorModal({ item, templates, onClose, onSave, onDelete, colorScheme }) {
  const [templateId, setTemplateId] = useState(item?.templateId || templates[0]?.id || '');
  const [name, setName] = useState(item?.name || '');
  const [quantity, setQuantity] = useState(item?.quantity?.toString() || '1');
  const [subLocation, setSubLocation] = useState(item?.subLocation || '');
  const [dynamicAttributes, setDynamicAttributes] = useState([]);
  
  // DatePicker states
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [activeDateIndex, setActiveDateIndex] = useState(null);

  const selectedTemplate = useMemo(() => templates.find(t => t.id === templateId), [templateId, templates]);

  useEffect(() => {
    if (item && item.templateId === templateId) {
      const attrs = [];
      selectedTemplate?.attributes?.forEach(tAttr => {
        attrs.push({ name: tAttr.name, type: tAttr.type, value: item.attributes?.[tAttr.name] || '' });
      });
      setDynamicAttributes(attrs);
    } else if (selectedTemplate) {
      setSubLocation(selectedTemplate.subLocations?.[0] || '');
      setDynamicAttributes(selectedTemplate.attributes?.map(attr => ({ name: attr.name, type: attr.type, value: '' })) || []);
    }
  }, [templateId, selectedTemplate, item]);

  const handleDateChange = (event, selectedDate) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate && activeDateIndex !== null) {
      const dateString = selectedDate.toISOString().split('T')[0];
      const next = [...dynamicAttributes];
      next[activeDateIndex].value = dateString;
      setDynamicAttributes(next);
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) return Alert.alert("エラー", "アイテム名称を入力してください");
    const attributeMap = {};
    dynamicAttributes.forEach(attr => { if (attr.name) attributeMap[attr.name] = attr.value; });
    
    onSave({ templateId, name, quantity: Number(quantity), subLocation, attributes: attributeMap });
  };

  return (
    <Modal transparent animationType="slide">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <View className="flex-1 bg-slate-900/60 justify-end">
          <View className="bg-white dark:bg-slate-900 w-full rounded-t-[3rem] shadow-xl max-h-[90%] flex-col">
            <View className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex-row items-center justify-between">
              <Text className="font-bold text-xl text-slate-800 dark:text-white">{item ? 'アイテム編集' : 'モノを登録'}</Text>
              <TouchableOpacity onPress={onClose} className="p-2"><X size={20} color="#94a3b8" /></TouchableOpacity>
            </View>
            
            <ScrollView contentContainerStyle={{ padding: 32, paddingBottom: 60 }}>
              <View style={{ gap: 24 }}>
                
                <View className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-2xl border border-amber-100 dark:border-amber-900/30">
                  <Text className="text-[10px] font-bold text-amber-600 dark:text-amber-500 mb-2">テンプレートを選択</Text>
                  <CustomSelect 
                    value={templates.find(t => t.id === templateId)?.name || ''}
                    options={templates.map(t => ({ label: t.name, value: t.id }))}
                    onChange={(val) => setTemplateId(val)}
                  />
                </View>

                <View>
                  <Text className="text-[10px] font-bold text-slate-400 mb-2">アイテム名称 *</Text>
                  <TextInput 
                    placeholder="名称を入力" placeholderTextColor="#94a3b8"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-3 text-sm font-bold text-slate-800 dark:text-white" 
                    value={name} onChangeText={setName} 
                  />
                </View>

                <View className="flex-row" style={{ gap: 16 }}>
                  <View className="flex-1">
                    <Text className="text-[10px] font-bold text-slate-400 mb-2">数量</Text>
                    <TextInput 
                      keyboardType="numeric"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-3 text-sm font-bold text-slate-800 dark:text-white" 
                      value={quantity} onChangeText={setQuantity} 
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[10px] font-bold text-slate-400 mb-2">保存先</Text>
                    <CustomSelect 
                      value={subLocation}
                      options={selectedTemplate?.subLocations || []}
                      onChange={setSubLocation}
                      placeholder="なし"
                    />
                  </View>
                </View>

                <View style={{ gap: 16, marginTop: 8 }}>
                  {dynamicAttributes.map((attr, i) => (
                    <View key={i} className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700" style={{ gap: 12 }}>
                      <Text className="text-[10px] font-bold text-slate-600 dark:text-slate-400">{attr.name} ({attr.type})</Text>
                      
                      {attr.type === 'checkbox' ? (
                        <TouchableOpacity
                          onPress={() => {
                            const next = [...dynamicAttributes];
                            next[i].value = next[i].value === 'true' ? 'false' : 'true';
                            setDynamicAttributes(next);
                          }}
                          className="flex-row items-center gap-3 py-2"
                        >
                          {attr.value === 'true'
                            ? <CheckSquare size={28} color="#d97706" />
                            : <Square size={28} color="#94a3b8" />
                          }
                          <Text className={`text-sm font-bold ${attr.value === 'true' ? 'text-amber-600' : 'text-slate-400'}`}>
                            {attr.value === 'true' ? 'チェック済み ✓' : '未チェック'}
                          </Text>
                        </TouchableOpacity>
                      ) : attr.type === 'date' ? (
                        <TouchableOpacity
                          onPress={() => { setActiveDateIndex(i); setShowDatePicker(true); }}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3"
                        >
                          <Text className={`text-sm font-bold ${attr.value ? 'text-slate-800 dark:text-white' : 'text-slate-400'}`}>
                            {attr.value || "日付を選択"}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TextInput
                          placeholder="値を入力" placeholderTextColor="#94a3b8"
                          keyboardType={attr.type === 'number' ? 'numeric' : 'default'}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white"
                          value={attr.value} onChangeText={(val) => {
                            const next = [...dynamicAttributes]; next[i].value = val; setDynamicAttributes(next);
                          }}
                        />
                      )}
                    </View>
                  ))}
                </View>

                <View style={{ gap: 16, marginTop: 16 }}>
                  <TouchableOpacity onPress={handleSubmit} className="w-full bg-amber-600 py-4 rounded-3xl items-center flex-row justify-center shadow-sm" style={{ gap: 8 }}>
                    <Save size={20} color="white" />
                    <Text className="text-white font-bold text-base">保存する</Text>
                  </TouchableOpacity>
                  {item && (
                    <TouchableOpacity onPress={() => onDelete(item.id)} className="py-3 items-center">
                      <Text className="text-slate-400 font-bold text-xs">このアイテムを削除</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </ScrollView>

            {showDatePicker && (
              <View className="absolute bottom-0 left-0 right-0 bg-white dark:bg-slate-800 z-50 border-t border-slate-200 dark:border-slate-700 pb-8 shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
                {Platform.OS === 'ios' && (
                  <View className="flex-row justify-end p-4 border-b border-slate-100 dark:border-slate-700">
                    <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                      <Text className="text-amber-600 font-bold text-base">完了</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <DateTimePicker
                  value={dynamicAttributes[activeDateIndex]?.value ? new Date(dynamicAttributes[activeDateIndex].value) : new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleDateChange}
                  textColor={colorScheme === 'dark' ? 'white' : 'black'}
                  locale="ja-JP"
                />
              </View>
            )}

          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- Template Editor Modal ---
function TemplateEditorModal({ template, onClose, onSave, onDelete }) {
  const [name, setName] = useState(template?.name || '');
  const [subLocations, setSubLocations] = useState(template?.subLocations || []);
  const [attributes, setAttributes] = useState(template?.attributes || []);

  const attributeOptions = [
    { label: '文字 (Text)', value: 'text' }, { label: '数値 (Number)', value: 'number' },
    { label: '日付 (Date)', value: 'date' }, { label: 'タグ (Tag)', value: 'tag' },
    { label: 'URL', value: 'url' }, { label: 'チェック (Checkbox)', value: 'checkbox' }
  ];

  const handleSubmit = () => {
    if (!name.trim()) return Alert.alert("エラー", "テンプレート名称を入力してください");
    onSave({ name, subLocations, attributes });
  };

  return (
    <Modal transparent animationType="slide">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <View className="flex-1 bg-slate-900/60 justify-center items-center p-4">
          <View className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[2.5rem] shadow-xl overflow-hidden max-h-[85%] flex-col">
            <View className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex-row items-center justify-between">
              <Text className="font-bold text-xl text-slate-800 dark:text-white">テンプレート編集</Text>
              <TouchableOpacity onPress={onClose} className="p-2"><X size={20} color="#94a3b8" /></TouchableOpacity>
            </View>
            
            <ScrollView contentContainerStyle={{ padding: 32, paddingBottom: 60 }}>
              <View style={{ gap: 24 }}>
                <TextInput 
                  placeholder="名称 (例: 冷蔵庫)" placeholderTextColor="#94a3b8"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-4 text-sm font-bold text-slate-800 dark:text-white" 
                  value={name} onChangeText={setName} 
                />
                
                <View>
                  <View className="flex-row justify-between items-center mb-3">
                    <Text className="text-[10px] font-bold text-slate-400">階層オプション</Text>
                    <TouchableOpacity onPress={() => setSubLocations([...subLocations, ''])}>
                      <Text className="text-amber-600 text-[10px] font-bold">+ 追加</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ gap: 12 }}>
                    {subLocations.map((loc, idx) => (
                      <View key={idx} className="flex-row items-center" style={{ gap: 8 }}>
                        <TextInput 
                          className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white" 
                          value={loc} onChangeText={(val) => { const next = [...subLocations]; next[idx] = val; setSubLocations(next); }} 
                        />
                        <TouchableOpacity onPress={() => setSubLocations(subLocations.filter((_, i) => i !== idx))} className="p-2">
                          <Trash2 size={16} color="#cbd5e1" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>

                <View>
                  <View className="flex-row justify-between items-center mb-3">
                    <Text className="text-[10px] font-bold text-slate-400">デフォルト属性</Text>
                    <TouchableOpacity onPress={() => setAttributes([...attributes, { name: '', type: 'text' }])}>
                      <Text className="text-amber-600 text-[10px] font-bold">+ 追加</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ gap: 12 }}>
                    {attributes.map((attr, idx) => (
                      <View key={idx} className="bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl border border-slate-100 dark:border-slate-700" style={{ gap: 8 }}>
                        <View className="flex-row items-center" style={{ gap: 8 }}>
                          <TextInput 
                            placeholder="項目名" placeholderTextColor="#cbd5e1"
                            className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-bold text-slate-800 dark:text-white" 
                            value={attr.name} onChangeText={(val) => { const next = [...attributes]; next[idx].name = val; setAttributes(next); }} 
                          />
                          <TouchableOpacity onPress={() => setAttributes(attributes.filter((_, i) => i !== idx))} className="p-2">
                            <Trash2 size={16} color="#cbd5e1" />
                          </TouchableOpacity>
                        </View>
                        <CustomSelect 
                          value={attributeOptions.find(opt => opt.value === attr.type)?.label || '文字 (Text)'}
                          options={attributeOptions}
                          onChange={(val) => { const next = [...attributes]; next[idx].type = val; setAttributes(next); }}
                        />
                      </View>
                    ))}
                  </View>
                </View>

                <View style={{ gap: 16, marginTop: 16 }}>
                  <TouchableOpacity onPress={handleSubmit} className="w-full bg-amber-600 py-4 rounded-3xl items-center shadow-sm">
                    <Text className="text-white font-bold text-base">保存する</Text>
                  </TouchableOpacity>
                  {template && (
                    <TouchableOpacity onPress={() => onDelete(template.id)} className="py-2 items-center">
                      <Text className="text-slate-400 font-bold text-xs">このテンプレートを削除</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Preset Selection Modal
function PresetSelectionModal({ onClose, onSelect }) {
  return (
    <Modal transparent animationType="fade">
      <View className="flex-1 bg-slate-900/60 justify-center items-center p-4">
        <View className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[2.5rem] shadow-xl overflow-hidden max-h-[80%]">
          <View className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex-row items-center justify-between">
            <Text className="font-bold text-lg text-slate-800 dark:text-white">プリセット</Text>
            <TouchableOpacity onPress={onClose} className="p-2"><X size={20} color="#94a3b8" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {PRESET_TEMPLATES.map((preset, i) => (
              <TouchableOpacity key={i} onPress={() => onSelect(preset)} className="p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl">
                <Text className="font-bold text-slate-800 dark:text-white text-base">{preset.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
