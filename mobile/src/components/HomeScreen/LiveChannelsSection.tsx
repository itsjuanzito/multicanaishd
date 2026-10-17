// mobile/src/components/HomeScreen/LiveChannelsSection.tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView
} from 'react-native';
import { Channel, getCategoriasUnicas } from '../../services/channelsService';
import { NowPlayingInfo } from '../../services/epgService';
import FadeInView from '../animations/FadeInView';
import PressableScale from '../animations/PressableScale';
import { styles } from './LiveChannelsSection.styles';

interface LiveChannelsSectionProps {
  liveChannels: Channel[];
  vipChannelIds: Set<string>;
  nowPlaying: Record<string, NowPlayingInfo>;
  hasError: boolean;
  onRetry: () => void;
  onWatchChannel: (channel: Channel) => void;
}

// Subcomponente individual para otimização extrema de re-render (Pilar 7)
const ChannelCard = React.memo(({
  item,
  isVIP,
  epgTitle,
  onPress
}: {
  item: Channel;
  isVIP: boolean;
  epgTitle?: string;
  onPress: () => void;
}) => {
  const [imageError, setImageError] = useState(false);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  return (
    <PressableScale
      style={styles.channelCard}
      onPress={onPress}
    >
      <View style={styles.logoContainer}>
        {!imageError ? (
          <Image
            source={{ uri: item.imagem }}
            style={styles.logoImage}
            resizeMode="contain"
            onError={handleImageError}
          />
        ) : (
          <Text style={styles.logoFallback}>📺</Text>
        )}

        <View style={styles.liveTagContainer}>
          <Text style={styles.liveTagText}>AO VIVO</Text>
        </View>

        {isVIP && (
          <View style={styles.vipTagContainer}>
            <Text style={styles.vipTagText}>💎</Text>
          </View>
        )}
      </View>

      <Text style={styles.channelName} numberOfLines={1}>
        {item.nome}
      </Text>

      <Text style={styles.channelCategoryText} numberOfLines={1}>
        {item.categoria || 'Geral'}
      </Text>

      {epgTitle ? (
        <Text style={styles.channelEpg} numberOfLines={1}>
          Agora: {epgTitle}
        </Text>
      ) : null}
    </PressableScale>
  );
});

function LiveChannelsSection({
  liveChannels,
  vipChannelIds,
  nowPlaying,
  hasError,
  onRetry,
  onWatchChannel
}: LiveChannelsSectionProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState<number>(6);

  const categories = useMemo(() => {
    return getCategoriasUnicas(liveChannels);
  }, [liveChannels]);

  const filteredChannels = useMemo(() => {
    if (selectedCategory === 'all') {
      return liveChannels.filter(c => {
        const cat = c.categoria?.toLowerCase();
        return cat !== '⚽ jogos ao vivo' && cat !== 'jogos ao vivo';
      });
    }

    return liveChannels.filter(c =>
      c.categoria && c.categoria.trim().toLowerCase() === selectedCategory.trim().toLowerCase()
    );
  }, [liveChannels, selectedCategory]);

  const visibleChannels = useMemo(() => {
    return filteredChannels.slice(0, visibleCount);
  }, [filteredChannels, visibleCount]);

  const handleSelectCategory = useCallback((category: string) => {
    setSelectedCategory(category);
    setVisibleCount(6);
  }, []);

  const handleLoadMore = useCallback(() => {
    setVisibleCount(prev => prev + 6);
  }, []);

  return (
    <FadeInView style={styles.section}>

      {/* Header com contadores reais (Pilar 1) */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleContainer}>
          <View style={styles.sectionTitleIndicator} />
          <Text style={styles.sectionTitle}>Canais Ao Vivo</Text>
        </View>
        {!hasError && (
          <Text style={styles.channelsCountText}>
            <Text style={styles.channelsCountHighlight}>{filteredChannels.length}</Text> de {liveChannels.length} canais
          </Text>
        )}
      </View>

      {hasError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Não foi possível carregar os canais agora.</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={onRetry}
            activeOpacity={0.85}
          >
            <Text style={styles.retryButtonText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Barra de Categorias Horizontal (Pilar 1) */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoriesContainer}
            contentContainerStyle={styles.categoriesList}
          >
            <TouchableOpacity
              style={[
                styles.categoryPill,
                selectedCategory === 'all' && styles.categoryPillActive
              ]}
              onPress={() => handleSelectCategory('all')}
              activeOpacity={0.8}
            >
              <Text style={[
                styles.categoryPillText,
                selectedCategory === 'all' && styles.categoryPillTextActive
              ]}>
                Todos
              </Text>
            </TouchableOpacity>

            {categories.map((category) => (
              <TouchableOpacity
                key={`cat-pill-${category}`}
                style={[
                  styles.categoryPill,
                  selectedCategory === category && styles.categoryPillActive
                ]}
                onPress={() => handleSelectCategory(category)}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.categoryPillText,
                  selectedCategory === category && styles.categoryPillTextActive
                ]}>
                  {category}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Grade de Canais (2 colunas) */}
          <View style={styles.channelsGrid}>
            {visibleChannels.length > 0 ? (
              visibleChannels.map((item) => {
                const isVIP = vipChannelIds.has(String(item.id)) || item.isVIP === true;
                return (
                  <ChannelCard
                    key={`live-channel-${item.id}-${item.nome}`}
                    item={item}
                    isVIP={isVIP}
                    epgTitle={nowPlaying[item.id]?.title}
                    onPress={() => onWatchChannel(item)}
                  />
                );
              })
            ) : (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>Nenhum canal nesta categoria.</Text>
              </View>
            )}
          </View>

          {filteredChannels.length > visibleCount && (
            <TouchableOpacity
              style={styles.loadMoreButton}
              onPress={handleLoadMore}
              activeOpacity={0.85}
            >
              <Text style={styles.loadMoreText}>Ver Mais Canais ▾</Text>
            </TouchableOpacity>
          )}
        </>
      )}

    </FadeInView>
  );
}

export default React.memo(LiveChannelsSection);
