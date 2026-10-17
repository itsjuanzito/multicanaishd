import React, { useState, useEffect, useCallback } from 'react';
import { 
  View,
  Text,
  ScrollView,
  TouchableOpacity
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import {
  getTrendingMedia,
  getPopularMovies,
  getPopularSeries,
  getAnimes,
  getDoramas,
  getComedy,
  getHorrorThriller,
  getKDramas,
  getFamily,
  TMDBMedia
} from '../services/tmdbService';
import {
  fetchTodayRelevantGames,
  getGameTimeStatus,
  isGameVIP,
  LiveGame
} from '../services/liveGamesService';
import {
  fetchCanais,
  fetchVipChannels,
  Channel
} from '../services/channelsService';
import { getNowPlayingBulk, NowPlayingInfo } from '../services/epgService';
import { getContinueWatching, ContinueWatchingItem } from '../services/historyService';
import { styles } from './HomeScreen.styles';
import LoadingScreen from '../components/LoadingScreen';

// Subcomponentes Modulares
import HeroCarousel from '../components/HomeScreen/HeroCarousel';
import LiveGamesSection from '../components/HomeScreen/LiveGamesSection';
import Top10Section from '../components/HomeScreen/Top10Section';
import MediaSection from '../components/HomeScreen/MediaSection';
import LiveChannelsSection from '../components/HomeScreen/LiveChannelsSection';
import ContinueWatchingSection from '../components/HomeScreen/ContinueWatchingSection';
import DailyTipSection from '../components/HomeScreen/DailyTipSection';
import AllGamesModal from '../components/HomeScreen/AllGamesModal';
import NotificationsBell from '../components/HomeScreen/NotificationsBell';

interface HomeScreenProps {
  isVIP?: boolean;
  isAuthenticated?: boolean;
  userId?: string;
  onLogout?: () => void;
  onOpenMenu?: () => void;
}

function HomeScreen({ isVIP = false, isAuthenticated = false, userId, onLogout, onOpenMenu }: HomeScreenProps) {
  const navigation = useNavigation<any>();
  const [heroSlides, setHeroSlides] = useState<TMDBMedia[]>([]);
  const [top10Week, setTop10Week] = useState<TMDBMedia[]>([]);
  const [popularMovies, setPopularMovies] = useState<TMDBMedia[]>([]);
  const [popularSeries, setPopularSeries] = useState<TMDBMedia[]>([]);
  const [animes, setAnimes] = useState<TMDBMedia[]>([]);
  const [doramas, setDoramas] = useState<TMDBMedia[]>([]);
  const [actionAdventure, setActionAdventure] = useState<TMDBMedia[]>([]);
  const [comedy, setComedy] = useState<TMDBMedia[]>([]);
  const [horrorThriller, setHorrorThriller] = useState<TMDBMedia[]>([]);
  const [kdramas, setKDramas] = useState<TMDBMedia[]>([]);
  const [family, setFamily] = useState<TMDBMedia[]>([]);
  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);
  const [continueWatching, setContinueWatching] = useState<ContinueWatchingItem[]>([]);

  // Estados para Canais Ao Vivo (Pilar 2 & 7)
  const [liveChannels, setLiveChannels] = useState<Channel[]>([]);
  const [vipChannelIds, setVipChannelIds] = useState<Set<string>>(new Set());
  const [nowPlaying, setNowPlaying] = useState<Record<string, NowPlayingInfo>>({});
  const [channelsError, setChannelsError] = useState(false);

  const [loading, setLoading] = useState(true);

  // Modal para ver todos os jogos
  const [allGamesModalVisible, setAllGamesModalVisible] = useState(false);

  // Busca canais + VIP IDs + EPG, isolado do resto da home para que uma falha na API
  // de canais não derrube o carregamento do catálogo inteiro (sem fallback estático).
  const loadChannels = useCallback(async () => {
    try {
      setChannelsError(false);
      const [channelsData, vipChannelsData] = await Promise.all([
        fetchCanais(),
        fetchVipChannels()
      ]);

      setLiveChannels(channelsData);
      setVipChannelIds(new Set(vipChannelsData));

      getNowPlayingBulk(channelsData.map(c => c.id))
        .then(setNowPlaying)
        .catch(() => {});
    } catch (err) {
      console.error('Erro ao carregar canais ao vivo:', err);
      setChannelsError(true);
    }
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [
          trending,
          movies,
          series,
          animeList,
          doramaList,
          comedyList,
          horrorThrillerList,
          kdramaList,
          familyList,
          games
        ] = await Promise.all([
          getTrendingMedia(),
          getPopularMovies(),
          getPopularSeries(),
          getAnimes(),
          getDoramas(),
          getComedy(),
          getHorrorThriller(),
          getKDramas(),
          getFamily(),
          fetchTodayRelevantGames()
        ]);

        // Carrega os 5 primeiros trendings para o carrossel do Hero
        setHeroSlides(trending.slice(0, 5));

        // Define o TOP 10 da Semana baseado nos trending media da semana
        setTop10Week(trending.slice(0, 10));

        // Define categorias principais
        setPopularMovies(movies);
        setPopularSeries(series);
        setAnimes(animeList);
        setDoramas(doramaList);
        setComedy(comedyList);
        setHorrorThriller(horrorThrillerList);
        setKDramas(kdramaList);
        setFamily(familyList);

        // Categoria de Ação & Aventura
        setActionAdventure(movies.slice(2, 9));

        setLiveGames(games);
      } catch (err) {
        console.error('Erro ao carregar os dados do catálogo:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
    loadChannels();
  }, [loadChannels]);

  // Continuar Assistindo: só busca se houver usuário autenticado (sem fallback fake)
  useEffect(() => {
    if (!isAuthenticated || !userId) {
      setContinueWatching([]);
      return;
    }
    getContinueWatching(userId).then(setContinueWatching).catch(() => setContinueWatching([]));
  }, [isAuthenticated, userId]);

  const handleWatchMedia = useCallback((media: TMDBMedia) => {
    navigation.navigate('Details', { media });
  }, [navigation]);

  const handleWatchContinueItem = useCallback((item: ContinueWatchingItem) => {
    navigation.navigate('Details', {
      media: {
        id: item.id,
        title: item.title,
        category: 'Geral',
        rating: '0',
        banner: item.backdrop,
        poster: item.poster,
        overview: '',
        year: '',
        type: item.type
      } as TMDBMedia
    });
  }, [navigation]);

  const handleWatchGame = useCallback((game: LiveGame) => {
    const isGameVip = isGameVIP(game, vipChannelIds);
    if (isGameVip && !isVIP) {
      alert(`🔒 Transmissão VIP Premium\n\nEsta partida está disponível exclusivamente para assinantes MultiCanaisHD VIP.\n\nAssine em nosso site para liberar o acesso instantâneo!`);
      return;
    }

    const status = getGameTimeStatus(game);
    if (status.type === 'upcoming') {
      alert(`🕒 Esta partida de '${game.title}' começa ${status.label}. Fique atento!`);
    } else {
      const streamUrl = game.url || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
      navigation.navigate('Player', {
        streamUrl: streamUrl,
        title: game.title,
        category: 'Futebol Ao Vivo',
        isEmbed: true // Jogos de futebol usam iframe/WebView
      });
    }
  }, [navigation, vipChannelIds, isVIP]);

  // Callback memoizado para assistir canais validando permissões VIP (Pilar 2, 3 & 7)
  const handleWatchChannel = useCallback((channel: Channel) => {
    const isChannelVIP = vipChannelIds.has(String(channel.id)) || channel.isVIP === true;
    if (isChannelVIP && !isVIP) {
      alert(`🔒 Canal VIP Premium\n\nEste canal está disponível exclusivamente para assinantes MultiCanaisHD VIP.\n\nAssine em nosso site para liberar o acesso instantâneo!`);
    } else {
      navigation.navigate('Player', {
        streamUrl: channel.url,
        title: channel.nome,
        category: channel.categoria || 'Canal de TV',
        isEmbed: true // Canais de TV usam embed/WebView
      });
    }
  }, [navigation, vipChannelIds, isVIP]);

  const handleViewAllGames = useCallback(() => {
    setAllGamesModalVisible(true);
  }, []);

  const handleCloseAllGamesModal = useCallback(() => {
    setAllGamesModalVisible(false);
  }, []);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#050505' }}>
      {/* CABEÇALHO PREMIUM TRANSPARENTE E FLUTUANTE (OVERLAY LOCAL - Pilar 1 & 7) */}
      <View style={styles.brandHeader}>
        {/* Esquerda: Botão Hamburger */}
        <TouchableOpacity 
          style={styles.hamburgerButton} 
          onPress={onOpenMenu}
          activeOpacity={0.7}
        >
          <View style={styles.hamburgerLine} />
          <View style={[styles.hamburgerLine, { width: 16 }]} />
          <View style={styles.hamburgerLine} />
        </TouchableOpacity>

        {/* Centro: Logotipo MultiCanaisHD */}
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>MULTI<Text style={styles.logoRed}>FLIX</Text></Text>
        </View>

        {/* Direita: Notificações + Busca */}
        <View style={styles.headerRightGroup}>
          <NotificationsBell />
          <TouchableOpacity
            style={styles.searchHeaderButton}
            onPress={() => navigation.navigate('Search')}
            activeOpacity={0.7}
          >
            <Feather name="search" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      
      {/* SECTION: HERO BANNER CAROUSEL */}
      <HeroCarousel
        heroSlides={heroSlides}
        onWatchMedia={handleWatchMedia}
      />

      {/* SECTION: CONTINUAR ASSISTINDO (só aparece autenticado + com histórico) */}
      <ContinueWatchingSection
        items={continueWatching}
        onWatchItem={handleWatchContinueItem}
      />

      {/* SECTION: JOGOS AO VIVO */}
      <LiveGamesSection
        liveGames={liveGames}
        vipChannelIds={vipChannelIds}
        onWatchGame={handleWatchGame}
        onViewAllGames={handleViewAllGames}
      />

      {/* SECTION: TOP 10 DA SEMANA */}
      <Top10Section
        top10Week={top10Week}
        onWatchMedia={handleWatchMedia}
      />

      {/* SECTION: DICA DE HOJE */}
      <DailyTipSection
        trending={top10Week}
        onWatchMedia={handleWatchMedia}
      />

      {/* SECTION: FILMES POPULARES */}
      <MediaSection 
        title="Filmes Populares" 
        data={popularMovies} 
        keyPrefix="pop-movie" 
        onWatchMedia={handleWatchMedia} 
      />

      {/* SECTION: SÉRIES EM ALTA */}
      <MediaSection 
        title="Séries em Alta" 
        data={popularSeries} 
        keyPrefix="pop-series" 
        onWatchMedia={handleWatchMedia} 
      />

      {/* SECTION: AÇÃO & AVENTURA */}
      <MediaSection 
        title="Ação & Aventura" 
        data={actionAdventure} 
        keyPrefix="act" 
        onWatchMedia={handleWatchMedia} 
      />

      {/* SECTION: ANIMES EM ALTA */}
      <MediaSection 
        title="Animes em Alta" 
        data={animes} 
        keyPrefix="anime" 
        onWatchMedia={handleWatchMedia} 
      />

      {/* SECTION: DORAMAS COREANOS */}
      <MediaSection
        title="Doramas Coreanos"
        data={doramas}
        keyPrefix="dorama"
        onWatchMedia={handleWatchMedia}
      />

      {/* SECTION: COMÉDIA */}
      <MediaSection
        title="Comédia"
        data={comedy}
        keyPrefix="comedy"
        onWatchMedia={handleWatchMedia}
      />

      {/* SECTION: TERROR & SUSPENSE */}
      <MediaSection
        title="Terror & Suspense"
        data={horrorThriller}
        keyPrefix="horror"
        onWatchMedia={handleWatchMedia}
      />

      {/* SECTION: K-DRAMAS */}
      <MediaSection
        title="K-Dramas"
        data={kdramas}
        keyPrefix="kdrama"
        onWatchMedia={handleWatchMedia}
      />

      {/* SECTION: FAMÍLIA */}
      <MediaSection
        title="Família"
        data={family}
        keyPrefix="family"
        onWatchMedia={handleWatchMedia}
      />

      {/* SECTION: CANAIS AO VIVO (Pilar 1, 3 e 7) */}
      <LiveChannelsSection
        liveChannels={liveChannels}
        vipChannelIds={vipChannelIds}
        nowPlaying={nowPlaying}
        hasError={channelsError}
        onRetry={loadChannels}
        onWatchChannel={handleWatchChannel}
      />

      {/* MODAL SLIDING: VER TODOS OS JOGOS DA RODADA */}
      <AllGamesModal
        visible={allGamesModalVisible}
        onClose={handleCloseAllGamesModal}
        liveGames={liveGames}
        vipChannelIds={vipChannelIds}
        onWatchGame={handleWatchGame}
      />

      {/* Espaçamento extra no final para scroll confortável */}
      <View style={{ height: 40 }} />
    </ScrollView>
  </View>
  );
}

export default React.memo(HomeScreen);
