import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Image
} from 'react-native';
import { LiveGame, getGameTimeStatus, isGameVIP } from '../../services/liveGamesService';
import FadeInView from '../animations/FadeInView';
import PressableScale from '../animations/PressableScale';
import { styles } from './LiveGamesSection.styles';

interface LiveGamesSectionProps {
  liveGames: LiveGame[];
  vipChannelIds: Set<string>;
  onWatchGame: (game: LiveGame) => void;
  onViewAllGames: () => void;
}

function LiveGamesSection({ liveGames, vipChannelIds, onWatchGame, onViewAllGames }: LiveGamesSectionProps) {
  if (!liveGames || liveGames.length === 0) {
    return null;
  }

  return (
    <FadeInView style={styles.section}>
      {/* Header da seção idêntico ao site: Título + Badge + Botão "Ver Todos" */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleContainer}>
          <Text style={styles.sectionTitle}>Jogos Ao Vivo</Text>
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveBadgeText}>HOJE</Text>
          </View>
        </View>
        
        <TouchableOpacity 
          style={styles.viewAllGamesBtn}
          onPress={onViewAllGames}
          activeOpacity={0.7}
        >
          <Text style={styles.viewAllGamesBtnText}>VER TODOS OS JOGOS</Text>
        </TouchableOpacity>
      </View>
      
      <FlatList
        data={liveGames.slice(0, 5)}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => 'game-' + item.title}
        renderItem={({ item }) => {
          const status = getGameTimeStatus(item);
          const isLive = status.type === 'live';
          const isVip = isGameVIP(item, vipChannelIds);

          return (
            <PressableScale
              style={styles.gameCard}
              onPress={() => onWatchGame(item)}
            >
              {/* Cabeçalho do Card: Campeonato, VIP e Status */}
              <View style={styles.gameCardHeader}>
                <View style={styles.gameLeagueRow}>
                  <Text style={styles.gameLeagueText} numberOfLines={1}>
                    {item.data.league}
                  </Text>
                  {isVip && (
                    <View style={styles.gameVipBadge}>
                      <Text style={styles.gameVipBadgeText}>💎 VIP</Text>
                    </View>
                  )}
                </View>
                <View style={[
                  styles.gameStatusBadge,
                  isLive ? styles.gameStatusLive : styles.gameStatusUpcoming
                ]}>
                  <Text style={[
                    styles.gameStatusText,
                    isLive ? styles.gameStatusLiveText : styles.gameStatusUpcomingText
                  ]}>
                    {status.label}
                  </Text>
                </View>
              </View>

              {/* Conteúdo do Card: Confronto */}
              <View style={styles.gameVsContainer}>
                {/* Time Casa */}
                <View style={styles.gameTeamContainer}>
                  <View style={styles.gameBadgeContainer}>
                    {item.data.teams.home.image ? (
                      <Image 
                        source={{ uri: item.data.teams.home.image }} 
                        style={styles.gameTeamBadge}
                        resizeMode="contain"
                      />
                    ) : (
                      <Text style={styles.gameTeamInitial}>
                        {item.data.teams.home.name.charAt(0)}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.gameTeamName} numberOfLines={1}>
                    {item.data.teams.home.name}
                  </Text>
                </View>

                {/* VS */}
                <Text style={styles.gameVsText}>VS</Text>

                {/* Time Fora */}
                <View style={styles.gameTeamContainer}>
                  <View style={styles.gameBadgeContainer}>
                    {item.data.teams.away.image ? (
                      <Image 
                        source={{ uri: item.data.teams.away.image }} 
                        style={styles.gameTeamBadge}
                        resizeMode="contain"
                      />
                    ) : (
                      <Text style={styles.gameTeamInitial}>
                        {item.data.teams.away.name.charAt(0)}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.gameTeamName} numberOfLines={1}>
                    {item.data.teams.away.name}
                  </Text>
                </View>
              </View>

              {/* Botão de Ação do Card */}
              <View style={[styles.gameWatchButton, isLive && styles.gameWatchButtonLive]}>
                <Text style={styles.gameWatchButtonText}>
                  {isLive ? 'ASSISTIR AO VIVO' : 'VER TRANSMISSÃO'}
                </Text>
              </View>
            </PressableScale>
          );
        }}
        contentContainerStyle={styles.gamesList}
      />
    </FadeInView>
  );
}

export default React.memo(LiveGamesSection);
