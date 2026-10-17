import { StyleSheet, Dimensions } from 'react-native';

const { height } = Dimensions.get('window');

export const styles = StyleSheet.create({
  // MODAL STYLING: JOGOS DO DIA
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 5, 5, 0.96)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    height: height * 0.85,
    backgroundColor: '#141414',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  modalSubtitle: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  closeModalBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeModalBtnText: {
    color: '#8A8A8A',
    fontSize: 14,
    fontWeight: 'bold',
  },
  searchBarContainer: {
    marginBottom: 20,
  },
  searchInput: {
    backgroundColor: '#050505',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  modalListContent: {
    gap: 16,
    paddingBottom: 40,
  },
  modalGameRow: {
    backgroundColor: '#050505',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    padding: 16,
  },
  modalGameRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalLeagueText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  gameStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  gameStatusLive: {
    backgroundColor: '#FF5555',
  },
  gameStatusUpcoming: {
    backgroundColor: 'rgba(255, 236, 61, 0.15)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 236, 61, 0.3)',
  },
  gameStatusText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  gameStatusLiveText: {
    color: '#FFFFFF',
  },
  gameStatusUpcomingText: {
    color: '#FFEC3D',
  },
  gameVipBadge: {
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    borderColor: 'rgba(255, 215, 0, 0.25)',
    borderWidth: 0.5,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  gameVipBadgeText: {
    color: '#FFD700',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  modalGameVsBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginVertical: 10,
  },
  modalTeamBox: {
    alignItems: 'center',
    width: 100,
  },
  modalBadgeContainer: {
    width: 44,
    height: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    marginBottom: 8,
  },
  modalTeamBadge: {
    width: 28,
    height: 28,
  },
  gameTeamInitial: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    fontWeight: '900',
  },
  modalTeamName: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    width: '100%',
  },
  modalVsText: {
    color: '#FF5555',
    fontSize: 18,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  modalActionBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  modalActionBtnLive: {
    backgroundColor: 'rgba(255, 85, 85, 0.12)',
    borderColor: 'rgba(255, 85, 85, 0.3)',
  },
  modalActionBtnText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 40,
  },
  emptyStateText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 12,
    fontWeight: '700',
  },
});
