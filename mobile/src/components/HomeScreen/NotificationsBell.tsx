// mobile/src/components/HomeScreen/NotificationsBell.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  SiteNotification,
  getNotifications,
  getLastSeenTimestamp,
  markNotificationsSeen,
  countUnread
} from '../../services/notificationsService';
import { styles } from './NotificationsBell.styles';

const POLL_INTERVAL = 60000; // 60s, mesmo intervalo do site

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `há ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `há ${diffDays}d`;
}

function NotificationsBell() {
  const [notifications, setNotifications] = useState<SiteNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const lastSeenRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const [items, lastSeen] = await Promise.all([
      getNotifications(),
      getLastSeenTimestamp()
    ]);
    lastSeenRef.current = lastSeen;
    setNotifications(items);
    setUnreadCount(countUnread(items, lastSeen));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleOpen = useCallback(async () => {
    setModalVisible(true);
    if (unreadCount > 0) {
      await markNotificationsSeen();
      setUnreadCount(0);
    }
  }, [unreadCount]);

  const handleClose = useCallback(() => {
    setModalVisible(false);
  }, []);

  const handlePressItem = useCallback((item: SiteNotification) => {
    if (item.link && /^https?:\/\//.test(item.link)) {
      Linking.openURL(item.link).catch(() => {});
    }
  }, []);

  return (
    <>
      <TouchableOpacity
        style={styles.bellButton}
        onPress={handleOpen}
        activeOpacity={0.7}
      >
        <Feather name="bell" size={20} color="#FFFFFF" />
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal
        animationType="slide"
        transparent
        visible={modalVisible}
        onRequestClose={handleClose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>NOTIFICAÇÕES</Text>
              <TouchableOpacity style={styles.closeModalBtn} onPress={handleClose}>
                <Text style={styles.closeModalBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {notifications.length > 0 ? (
              <FlatList
                data={notifications}
                keyExtractor={item => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.notificationRow}
                    onPress={() => handlePressItem(item)}
                    activeOpacity={item.link ? 0.7 : 1}
                  >
                    <View style={styles.notificationDot} />
                    <View style={styles.notificationBody}>
                      <Text style={styles.notificationTitle}>{item.title}</Text>
                      <Text style={styles.notificationMessage}>{item.message}</Text>
                      <Text style={styles.notificationTime}>{formatRelativeTime(item.created_at)}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            ) : (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>Nenhuma notificação por enquanto.</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

export default NotificationsBell;
