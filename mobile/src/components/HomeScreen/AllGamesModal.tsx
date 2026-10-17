import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  FlatList, 
  Image, 
  Modal, 
  TextInput 
} from 'react-native';
import { LiveGame, getGameTimeStatus, isGameVIP } from '../../services/liveGamesService';
import { styles } from './AllGamesModal.styles';

interface AllGamesModalProps {
  visible: boolean;
  onClose: () => void;
  liveGames: LiveGame[];
  vipChannelIds: Set<string>;
  onWatchGame: (game: LiveGame) => void;
}

function AllGamesModal({ visible, onClose, liveGames, vipChannelIds, onWatchGame }: AllGamesModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filtra jogos com base na pesquisa
  const filteredGames = liveGames.filter(game => 
    game.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    game.data.league.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          
          {/* Header do Modal */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>JOGOS DO DIA</Text>
              <Text style={styles.modalSubtitle}>Grade completa de transmissões</Text>
            </View>
            <TouchableOpacity 
              style={styles.closeModalBtn}
              onPress={onClose}
            >
              <Text style={styles.closeModalBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Barra de Busca de Jogos */}
          <View style={styles.searchBarContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar por time ou campeonato..."
              placeholderTextColor="rgba(255, 255, 255, 0.4)"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
            />
          </View>

          {/* Lista de Jogos */}
          {filteredGames.length > 0 ? (
            <FlatList
              data={filteredGames}
              keyExtractor={(item) => 'modal-game-' + item.title}
              renderItem={({ item }) => {
                const status = getGameTimeStatus(item);
                const isLive = status.type === 'live';
                const isVip = isGameVIP(item, vipChannelIds);

                return (
                  <TouchableOpacity
                    style={styles.modalGameRow}
                    onPress={() => {
                      onClose();
                      onWatchGame(item);
                    }}
                    activeOpacity={0.85}
                  >
                    {/* Liga & Status superior */}
                    <View style={styles.modalGameRowHeader}>
                      <Text style={styles.modalLeagueText}>{item.data.league}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {isVip && (
                          <View style={styles.gameVipBadge}>
                            <Text style={styles.gameVipBadgeText}>💎 VIP</Text>
                          </View>
                        )}
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
                    </View>

                    {/* Placar / Confronto largo */}
                    <View style={styles.modalGameVsBlock}>
                      {/* Casa */}
                      <View style={styles.modalTeamBox}>
                        <View style={styles.modalBadgeContainer}>
                          {item.data.teams.home.image ? (
                            <Image 
                              source={{ uri: item.data.teams.home.image }} 
                              style={styles.modalTeamBadge} 
                              resizeMode="contain"
                            />
                          ) : (
                            <Text style={styles.gameTeamInitial}>{item.data.teams.home.name.charAt(0)}</Text>
                          )}
                        </View>
                        <Text style={styles.modalTeamName} numberOfLines={1}>
                          {item.data.teams.home.name}
                        </Text>
                      </View>

                      {/* VS */}
                      <Text style={styles.modalVsText}>VS</Text>

                      {/* Fora */}
                      <View style={styles.modalTeamBox}>
                        <View style={styles.modalBadgeContainer}>
                          {item.data.teams.away.image ? (
                            <Image 
                              source={{ uri: item.data.teams.away.image }} 
                              style={styles.modalTeamBadge} 
                              resizeMode="contain"
                            />
                          ) : (
                            <Text style={styles.gameTeamInitial}>{item.data.teams.away.name.charAt(0)}</Text>
                          )}
                        </View>
                        <Text style={styles.modalTeamName} numberOfLines={1}>
                          {item.data.teams.away.name}
                        </Text>
                      </View>
                    </View>

                    {/* Botão de Transmissão */}
                    <View style={[styles.modalActionBtn, isLive && styles.modalActionBtnLive]}>
                      <Text style={styles.modalActionBtnText}>
                        {isLive ? '🔴 ASSISTIR AGORA (AO VIVO)' : '🕒 AGENDAR TRANSMISSÃO'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalListContent}
            />
          ) : (
            <View style={styles.emptyStateContainer}>
              <Text style={styles.emptyStateText}>Nenhuma transmissão encontrada.</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

export default React.memo(AllGamesModal);
