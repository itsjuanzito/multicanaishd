// mobile/src/components/HomeScreen/DailyTipSection.tsx
import React, { useMemo } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { TMDBMedia } from '../../services/tmdbService';
import FadeInView from '../animations/FadeInView';
import PressableScale from '../animations/PressableScale';
import { styles } from './DailyTipSection.styles';

interface DailyTipSectionProps {
  trending: TMDBMedia[];
  onWatchMedia: (media: TMDBMedia) => void;
}

/**
 * Seleção determinística do dia: mesma fórmula usada no site (soma dos char codes
 * da data de hoje % quantidade de itens bem avaliados), sem precisar de persistência.
 */
function pickDailyTip(trending: TMDBMedia[]): TMDBMedia | null {
  if (!trending || trending.length === 0) return null;

  const highRated = trending.filter(item => parseFloat(item.rating) >= 8.2 && item.banner);
  const pool = highRated.length > 0 ? highRated : trending;

  const today = new Date().toISOString().split('T')[0];
  const seed = today.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);

  return pool[seed % pool.length];
}

function DailyTipSection({ trending, onWatchMedia }: DailyTipSectionProps) {
  const tip = useMemo(() => pickDailyTip(trending), [trending]);

  if (!tip) return null;

  return (
    <FadeInView style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleIndicator} />
        <Text style={styles.sectionTitle}>Dica de Hoje</Text>
      </View>

      <PressableScale style={styles.card} onPress={() => onWatchMedia(tip)}>
        <Image source={{ uri: tip.banner || tip.poster }} style={styles.image} />
        <LinearGradient
          colors={['transparent', 'rgba(5,5,5,0.4)', 'rgba(5,5,5,0.95)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.content}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>★ {tip.rating}</Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>{tip.title}</Text>
          <Text style={styles.overview} numberOfLines={2}>{tip.overview}</Text>
        </View>
      </PressableScale>
    </FadeInView>
  );
}

export default React.memo(DailyTipSection);
