// mobile/src/components/HomeScreen/ContinueWatchingSection.tsx
import React from 'react';
import { View, Text, FlatList, Image } from 'react-native';
import { ContinueWatchingItem } from '../../services/historyService';
import FadeInView from '../animations/FadeInView';
import PressableScale from '../animations/PressableScale';
import { styles } from './ContinueWatchingSection.styles';

interface ContinueWatchingSectionProps {
  items: ContinueWatchingItem[];
  onWatchItem: (item: ContinueWatchingItem) => void;
}

function ContinueWatchingSection({ items, onWatchItem }: ContinueWatchingSectionProps) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <FadeInView style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleIndicator} />
        <Text style={styles.sectionTitle}>Continuar Assistindo</Text>
      </View>
      <FlatList
        data={items}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={item => `continue-${item.id}-${item.type}`}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        removeClippedSubviews
        renderItem={({ item }) => (
          <PressableScale style={styles.card} onPress={() => onWatchItem(item)}>
            <Image source={{ uri: item.backdrop || item.poster }} style={styles.cardImage} />
            {item.progress > 0 && (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(item.progress, 6)}%` }]} />
              </View>
            )}
            <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
            {item.type === 'tv' && item.watchedCount > 0 && (
              <Text style={styles.cardWatchedText}>
                Assistido: {item.watchedCount}{item.totalEps ? `/${item.totalEps}` : ''} eps
              </Text>
            )}
          </PressableScale>
        )}
        contentContainerStyle={styles.list}
      />
    </FadeInView>
  );
}

export default React.memo(ContinueWatchingSection);
