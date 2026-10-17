import React from 'react';
import {
  View,
  Text,
  FlatList,
  Image
} from 'react-native';
import { TMDBMedia } from '../../services/tmdbService';
import FadeInView from '../animations/FadeInView';
import PressableScale from '../animations/PressableScale';
import { styles } from './MediaSection.styles';

interface MediaSectionProps {
  title: string;
  data: TMDBMedia[];
  keyPrefix: string;
  onWatchMedia: (media: TMDBMedia) => void;
}

function MediaSection({ title, data, keyPrefix, onWatchMedia }: MediaSectionProps) {
  if (!data || data.length === 0) {
    return null;
  }

  return (
    <FadeInView style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleIndicator} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <FlatList
        data={data}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={item => `${keyPrefix}-${item.id}`}
        renderItem={({ item }) => (
          <PressableScale
            style={styles.movieCard}
            onPress={() => onWatchMedia(item)}
          >
            <Image source={{ uri: item.poster }} style={styles.movieImage} />
            <View style={styles.movieBadge}>
              <Text style={styles.movieBadgeText}>★ {item.rating}</Text>
            </View>
            <Text style={styles.movieTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.movieCategory}>{item.category}</Text>
          </PressableScale>
        )}
        contentContainerStyle={styles.moviesList}
      />
    </FadeInView>
  );
}

export default React.memo(MediaSection);
