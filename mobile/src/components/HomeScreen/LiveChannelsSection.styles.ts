// mobile/src/components/HomeScreen/LiveChannelsSection.styles.ts
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  section: {
    marginTop: 28,
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitleIndicator: {
    width: 3.5,
    height: 18,
    backgroundColor: '#FF5555',
    borderRadius: 2,
    marginRight: 8,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.3,
    textTransform: 'uppercase',
  },
  channelsCountText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 10,
    fontWeight: '700',
  },
  channelsCountHighlight: {
    color: '#FFFFFF',
    fontWeight: '900',
  },

  // CATEGORIES / PILLS BAR
  categoriesContainer: {
    paddingLeft: 20,
    marginBottom: 16,
  },
  categoriesList: {
    gap: 8,
    paddingRight: 20,
  },
  categoryPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1f1f1f',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  categoryPillActive: {
    backgroundColor: '#FF5555',
    borderColor: '#FF5555',
    shadowColor: '#FF5555',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  categoryPillText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  categoryPillTextActive: {
    color: '#FFFFFF',
  },

  // CHANNELS GRID (Grade 2 colunas)
  channelsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  channelCard: {
    width: '48%',
    backgroundColor: '#141414',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    padding: 10,
    marginBottom: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },

  logoContainer: {
    width: '100%',
    aspectRatio: 1.6,
    backgroundColor: '#0c0c0c',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    position: 'relative',
    marginBottom: 10,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  logoFallback: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 28,
  },

  channelName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 17,
    marginBottom: 3,
  },
  liveTagContainer: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(255, 85, 85, 0.85)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  liveTagText: {
    color: '#FFFFFF',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  channelCategoryText: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  vipTagContainer: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(255, 215, 0, 0.85)',
    borderRadius: 10,
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  vipTagText: {
    fontSize: 9,
  },
  channelEpg: {
    color: '#FF5555',
    fontSize: 10,
    fontWeight: '700',
  },

  // EMPTY LIST / NO CHANNELS FOUND
  emptyContainer: {
    width: '100%',
    paddingVertical: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: '700',
  },

  // LOAD MORE / VER MAIS BUTTON (Pilar 1 & 4)
  loadMoreButton: {
    marginTop: 18,
    marginHorizontal: 20,
    paddingVertical: 13,
    backgroundColor: '#141414',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  loadMoreText: {
    color: '#FF5555',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  // ERROR STATE / RETRY
  errorContainer: {
    marginHorizontal: 20,
    paddingVertical: 28,
    paddingHorizontal: 20,
    backgroundColor: '#141414',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#FF5555',
    borderRadius: 10,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  }
});
