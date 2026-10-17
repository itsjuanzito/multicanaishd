import React from 'react';
import {
  View,
  Text,
  FlatList,
  Image
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { TMDBMedia } from '../../services/tmdbService';
import FadeInView from '../animations/FadeInView';
import PressableScale from '../animations/PressableScale';
import { styles } from './Top10Section.styles';

interface Top10SectionProps {
  top10Week: TMDBMedia[];
  onWatchMedia: (media: TMDBMedia) => void;
}

function Top10Section({ top10Week, onWatchMedia }: Top10SectionProps) {
  if (!top10Week || top10Week.length === 0) {
    return null;
  }

  return (
    <FadeInView style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleIndicator} />
        <Text style={styles.sectionTitle}>Top 10 da Semana</Text>
      </View>

      <FlatList
        data={top10Week}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={item => 'top10-' + item.id}
        renderItem={({ item, index }) => (
          <PressableScale
            style={styles.top10Card}
            onPress={() => onWatchMedia(item)}
          >
            {/* Número de rank gigante na base esquerda (Nunca corta) */}
            <Text style={[
              styles.top10Number,
              index === 9 && {
                fontSize: 110,
                left: -22,
                letterSpacing: -18,
                bottom: -6,
              }
            ]}>
              {index + 1}
            </Text>

            {/* Poster sobreposto com dimensões idênticas às capas normais */}
            <View style={styles.top10PosterContainer}>
              <Image source={{ uri: item.poster }} style={styles.top10Poster} />
              
              {/* Rating do Top10 */}
              <View style={styles.top10Badge}>
                <Text style={styles.top10BadgeText}>★ {item.rating}</Text>
              </View>

              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.85)']}
                style={styles.top10PosterGradient}
              />

              <Text style={styles.top10Title} numberOfLines={1}>
                {item.title}
              </Text>
            </View>
          </PressableScale>
        )}
        contentContainerStyle={styles.top10List}
      />
    </FadeInView>
  );
}

export default React.memo(Top10Section);
