import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  Image, 
  ScrollView, 
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TouchableWithoutFeedback
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { 
  TMDBMedia, 
  CastActor, 
  Season, 
  Episode,
  getMediaCreditsAndRecommendations, 
  getTVShowSeasons, 
  getTVShowSeasonEpisodes 
} from '../services/tmdbService';
import { styles } from './DetailsScreen.styles';

type DetailsScreenRouteProp = RouteProp<{
  params: {
    media: TMDBMedia;
  };
}, 'params'>;

function DetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<DetailsScreenRouteProp>();
  const { media } = route.params || {};

  const [cast, setCast] = useState<CastActor[]>([]);
  const [similar, setSimilar] = useState<TMDBMedia[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  
  const [loadingExtras, setLoadingExtras] = useState(true);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [seasonModalVisible, setSeasonModalVisible] = useState(false);

  const mediaType = media?.type || (media?.category?.toLowerCase().includes('série') || media?.category?.toLowerCase().includes('dorama') || media?.category?.toLowerCase().includes('anime') ? 'tv' : 'movie');

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Carrega Elenco e Recomendações
  useEffect(() => {
    if (!media) return;
    let active = true;
    async function fetchExtras() {
      setLoadingExtras(true);
      try {
        const { cast: castData, similar: similarData } = await getMediaCreditsAndRecommendations(media.id, mediaType);
        if (active) {
          setCast(castData);
          setSimilar(similarData);
        }
      } catch (err) {
        console.warn('Erro ao carregar elenco/similares:', err);
      } finally {
        if (active) setLoadingExtras(false);
      }
    }

    fetchExtras();
    return () => {
      active = false;
    };
  }, [media?.id, mediaType]);

  // Carrega Temporadas (se for série)
  useEffect(() => {
    if (!media || mediaType !== 'tv') return;
    let active = true;
    async function fetchSeasons() {
      try {
        const seasonsData = await getTVShowSeasons(media.id);
        if (active) {
          setSeasons(seasonsData);
          if (seasonsData.length > 0) {
            setSelectedSeason(seasonsData[0].seasonNumber);
          }
        }
      } catch (err) {
        console.warn('Erro ao carregar temporadas:', err);
      }
    }

    fetchSeasons();
    return () => {
      active = false;
    };
  }, [media?.id, mediaType]);

  // Carrega Episódios da Temporada Selecionada
  useEffect(() => {
    if (!media || mediaType !== 'tv' || !selectedSeason) return;
    let active = true;
    async function fetchEpisodes() {
      setLoadingEpisodes(true);
      try {
        const eps = await getTVShowSeasonEpisodes(media.id, selectedSeason);
        if (active) {
          setEpisodes(eps);
        }
      } catch (err) {
        console.warn('Erro ao carregar episódios:', err);
      } finally {
        if (active) setLoadingEpisodes(false);
      }
    }

    fetchEpisodes();
    return () => {
      active = false;
    };
  }, [media?.id, selectedSeason, mediaType]);

  const handleWatch = useCallback(() => {
    if (!media) return;

    if (mediaType === 'tv') {
      if (episodes.length > 0) {
        navigation.navigate('Player', {
          id: media.id,
          mediaType: 'series',
          season: String(selectedSeason),
          episode: String(episodes[0].episodeNumber),
          title: `${media.title} - T${selectedSeason}º E${episodes[0].episodeNumber}`,
          category: media.category || 'Série'
        });
      } else {
        alert('Carregando episódios, por favor aguarde...');
      }
    } else {
      navigation.navigate('Player', {
        id: media.id,
        mediaType: 'movie',
        title: media.title,
        category: media.category || 'Filme'
      });
    }
  }, [navigation, media, mediaType, episodes, selectedSeason]);

  if (!media) {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
          <Text style={styles.backButtonText}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 'bold' }}>
            Mídia não encontrada.
          </Text>
        </View>
      </View>
    );
  }

  // Fallbacks de alta fidelidade (Pilar 2)
  const posterImage = media.poster || media.banner;
  const overview = media.overview?.trim() || 'Nenhuma sinopse disponível para este título no momento.';
  const rating = media.rating || '8.5';
  const year = media.year || '2026';
  const category = media.category || 'Filmes & Séries';
  
  // Duração mockada premium baseada no tipo para realismo estético
  const duration = mediaType === 'tv' ? 'Série TV' : '2h 15min';

  return (
    <View style={styles.container}>
      {/* Botão Flutuante Voltar com Glassmorphism (Pilar 1) */}
      <TouchableOpacity 
        style={styles.backButton} 
        onPress={handleGoBack}
        activeOpacity={0.7}
      >
        <Text style={styles.backButtonText}>‹</Text>
      </TouchableOpacity>

      <ScrollView 
        style={styles.scrollContainer} 
        showsVerticalScrollIndicator={false}
      >
        {/* Banner Backdrop com Pôster Vertical e Blur Premium (Pilar 1) */}
        <View style={styles.backdropContainer}>
          <Image 
            source={{ uri: posterImage }} 
            style={styles.backdropBlurImage} 
            blurRadius={20}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['rgba(5, 5, 5, 0.4)', 'rgba(5, 5, 5, 0.8)', '#050505']}
            style={styles.backdropGradient}
          />
          
          <View style={styles.posterWrapper}>
            <Image 
              source={{ uri: media.poster }} 
              style={styles.verticalPoster} 
              resizeMode="cover"
            />
          </View>
        </View>

        {/* Informações de Detalhes da Mídia */}
        <View style={styles.contentContainer}>
          {/* Badge de Categoria */}
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>{category}</Text>
          </View>

          {/* Título Principal */}
          <Text style={styles.title}>{media.title}</Text>

          {/* Linha de Metadados Premium (Pilar 1) */}
          <View style={styles.metaRow}>
            <Text style={styles.metaYear}>{year}</Text>
            <Text style={styles.metaBullet}>•</Text>
            
            {/* Avaliação Estilizada */}
            <View style={styles.ratingContainer}>
              <Text style={styles.ratingStar}>★</Text>
              <Text style={styles.ratingText}>{rating}</Text>
            </View>
            
            <Text style={styles.metaBullet}>•</Text>

            {/* Duração/Temporadas */}
            <View style={styles.durationContainer}>
              <Text style={styles.durationText}>{duration}</Text>
            </View>
          </View>

          {/* Botão Primário ASSISTIR (Pilar 1) */}
          <TouchableOpacity 
            style={styles.playButton} 
            onPress={handleWatch}
            activeOpacity={0.85}
          >
            <Text style={styles.playIcon}>▶</Text>
            <Text style={styles.playButtonText}>
              {mediaType === 'tv' ? 'Assistir 1º Episódio' : 'Assistir Agora'}
            </Text>
          </TouchableOpacity>

          {/* Sinopse */}
          <Text style={styles.sectionTitle}>Sinopse</Text>
          <Text style={styles.overviewText}>{overview}</Text>

          {/* Elenco Principal Dinâmico (Pilar 1, 2 & 3) */}
          {loadingExtras ? (
            <ActivityIndicator size="small" color="#FF5555" style={{ marginVertical: 15 }} />
          ) : (
            cast.length > 0 && (
              <View style={styles.sectionContainer}>
                <Text style={styles.sectionTitle}>Elenco Principal</Text>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.castScroll}
                >
                  {cast.map(actor => (
                    <View key={actor.id} style={styles.actorCard}>
                      <Image 
                        source={{ uri: actor.profilePath || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150' }} 
                        style={styles.actorImage} 
                      />
                      <Text style={styles.actorName} numberOfLines={1}>{actor.name}</Text>
                      <Text style={styles.characterName} numberOfLines={1}>{actor.character}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )
          )}

          {/* Lista de Temporadas e Episódios se Série (Pilar 7) */}
          {mediaType === 'tv' && seasons.length > 0 && (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Episódios</Text>
              
              {/* Seletor de Temporadas Estilo Dropdown com Modal Bottom Sheet (Pilar 1 e 7) */}
              <TouchableOpacity
                style={styles.seasonSelectorButton}
                onPress={() => setSeasonModalVisible(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.seasonSelectorText}>
                  {seasons.find(s => s.seasonNumber === selectedSeason)?.name || `Temporada ${selectedSeason}`}
                </Text>
                <Text style={styles.seasonSelectorArrow}>▼</Text>
              </TouchableOpacity>

              {/* Bottom Sheet Modal Picker */}
              <Modal
                visible={seasonModalVisible}
                transparent={true}
                animationType="slide"
                statusBarTranslucent={true}
                onRequestClose={() => setSeasonModalVisible(false)}
              >
                <TouchableWithoutFeedback onPress={() => setSeasonModalVisible(false)}>
                  <View style={styles.modalOverlay}>
                    <TouchableWithoutFeedback>
                      <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                          <Text style={styles.modalTitle}>Selecionar Temporada</Text>
                          <TouchableOpacity 
                            style={styles.modalCloseButton} 
                            onPress={() => setSeasonModalVisible(false)}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.modalCloseText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                          {seasons.map(s => (
                            <TouchableOpacity
                              key={s.id}
                              style={[
                                styles.modalSeasonItem,
                                selectedSeason === s.seasonNumber && styles.modalSeasonItemActive
                              ]}
                              onPress={() => {
                                setSelectedSeason(s.seasonNumber);
                                setSeasonModalVisible(false);
                              }}
                              activeOpacity={0.8}
                            >
                              <Text style={[
                                styles.modalSeasonText,
                                selectedSeason === s.seasonNumber && styles.modalSeasonTextActive
                              ]}>
                                {s.name}
                              </Text>
                              <Text style={[
                                styles.modalSeasonCount,
                                selectedSeason === s.seasonNumber && styles.modalSeasonCountActive
                              ]}>
                                {s.episodeCount} {s.episodeCount === 1 ? 'episódio' : 'episódios'}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    </TouchableWithoutFeedback>
                  </View>
                </TouchableWithoutFeedback>
              </Modal>

              {/* Lista de Episódios da Temporada */}
              {loadingEpisodes ? (
                <ActivityIndicator size="small" color="#FF5555" style={{ marginVertical: 20 }} />
              ) : (
                <View style={styles.episodesList}>
                  {episodes.map(ep => (
                    <TouchableOpacity 
                      key={ep.id} 
                      style={styles.episodeCard}
                      onPress={() => {
                        navigation.navigate('Player', {
                          id: media.id,
                          mediaType: 'series',
                          season: String(selectedSeason),
                          episode: String(ep.episodeNumber),
                          title: `${media.title} - T${selectedSeason}º E${ep.episodeNumber}`,
                          category: media.category || 'Série'
                        });
                      }}
                      activeOpacity={0.85}
                    >
                      <Image 
                        source={{ uri: ep.stillPath || media.banner || media.poster }} 
                        style={styles.episodeThumb} 
                        resizeMode="cover"
                      />
                      <View style={styles.episodeInfo}>
                        <Text style={styles.episodeNumberText}>Episódio {ep.episodeNumber}</Text>
                        <Text style={styles.episodeTitle} numberOfLines={1}>{ep.name}</Text>
                        <Text style={styles.episodeOverview} numberOfLines={2}>{ep.overview || 'Sem sinopse disponível.'}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  {episodes.length === 0 && (
                    <Text style={styles.emptyText}>Nenhum episódio encontrado para esta temporada.</Text>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Títulos Similares Dinâmicos (Pilar 1, 2 & 3) */}
          {!loadingExtras && similar.length > 0 && (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Títulos Similares</Text>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.similarScroll}
              >
                {similar.map(item => (
                  <TouchableOpacity 
                    key={item.id} 
                    style={styles.similarCard}
                    onPress={() => navigation.push('Details', { media: item })}
                    activeOpacity={0.8}
                  >
                    <Image 
                      source={{ uri: item.poster }} 
                      style={styles.similarPoster} 
                      resizeMode="cover"
                    />
                    <Text style={styles.similarTitle} numberOfLines={1}>{item.title}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

        </View>
      </ScrollView>
    </View>
  );
}

export default React.memo(DetailsScreen);
