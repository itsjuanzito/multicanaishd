import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { TMDBMedia } from '../../services/tmdbService';
import PressableScale from '../animations/PressableScale';
import { styles } from './HeroCarousel.styles';

const { width } = Dimensions.get('window');

interface HeroCarouselProps {
  heroSlides: TMDBMedia[];
  onWatchMedia: (media: TMDBMedia) => void;
}

function PaginationDot({ active }: { active: boolean }) {
  return (
    <View style={[styles.paginationDot, active && styles.paginationDotActive]} />
  );
}

function HeroCarousel({ heroSlides, onWatchMedia }: HeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scrollOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(scrollOffset / width);
    if (index !== activeIndex && index >= 0 && index < heroSlides.length) {
      setActiveIndex(index);
    }
  };

  if (!heroSlides || heroSlides.length === 0) {
    return null;
  }

  return (
    <View style={styles.heroOuterContainer}>
      <FlatList
        data={heroSlides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        decelerationRate="fast"
        snapToInterval={width}
        snapToAlignment="center"
        onScroll={handleScroll}
        scrollEventThrottle={16}
        renderItem={({ item, index }) => (
          <View style={styles.heroContainer}>
            {/* Capa vertical cinemática para preenchimento ideal no celular */}
            <Image
              source={{ uri: item.poster }}
              style={styles.heroPosterBackdrop}
              resizeMode="cover"
            />

            {/* Sombra de topo escura (estendida para garantir contraste perfeito no floating header) */}
            <LinearGradient
              colors={['rgba(5, 5, 5, 0.95)', 'rgba(5, 5, 5, 0.6)', 'transparent']}
              style={styles.heroTopShadow}
            />

            {/* Sombra gradiente de fusão inferior profunda */}
            <LinearGradient
              colors={['transparent', 'rgba(5, 5, 5, 0.5)', '#050505']}
              style={styles.heroBottomGradient}
            />

            {/* Conteúdo sobreposto */}
            <View style={styles.heroContent}>
              <View style={styles.featuredBadge}>
                <Text style={styles.featuredBadgeText}>#{index + 1} DESTAQUE DA SEMANA</Text>
              </View>

              <Text style={styles.heroTitle} numberOfLines={2}>
                {item.title}
              </Text>

              <View style={styles.heroMeta}>
                <Text style={styles.heroMetaText}>{item.year}</Text>
                <Text style={styles.heroMetaBullet}>•</Text>
                <Text style={styles.heroMetaText}>{item.category}</Text>
                <Text style={styles.heroMetaBullet}>•</Text>
                <View style={styles.heroRating}>
                  <Text style={styles.heroRatingStar}>★</Text>
                  <Text style={styles.heroRatingText}>{item.rating}</Text>
                </View>
              </View>

              <View style={styles.heroDescriptionContainer}>
                <Text style={styles.heroDescription} numberOfLines={3}>
                  {item.overview}
                </Text>
              </View>

              <PressableScale
                style={styles.heroButton}
                onPress={() => onWatchMedia(item)}
              >
                <Text style={styles.heroButtonIcon}>▶</Text>
                <Text style={styles.heroButtonText}>ASSISTIR AGORA</Text>
              </PressableScale>

              {/* Indicador visual de paginação */}
              <View style={styles.paginationDotsContainer}>
                {heroSlides.map((_, dotIndex) => (
                  <PaginationDot key={dotIndex} active={activeIndex === dotIndex} />
                ))}
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
}

export default React.memo(HeroCarousel);
