import { StyleSheet, Dimensions, Platform } from 'react-native';

const { width, height } = Dimensions.get('window');

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  scrollContainer: {
    flex: 1,
  },
  
  // BACKDROP AREA
  backdropContainer: {
    width: '100%',
    height: height * 0.48,
    position: 'relative',
    backgroundColor: '#050505',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdropBlurImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.35,
  },
  backdropGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: height * 0.3,
  },
  
  // POSTER WRAPPER
  posterWrapper: {
    width: 154,
    height: 228,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
    marginTop: 40,
  },
  verticalPoster: {
    width: '100%',
    height: '100%',
  },
  
  // FLOATING BACK BUTTON
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 44,
    left: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(5, 5, 5, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: -1,
    marginRight: 1,
  },
  
  // MEDIA CONTENT DETAILS
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    marginTop: -20, // Sobrepõe ligeiramente o gradiente do pôster
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 85, 85, 0.1)',
    borderWidth: 1,
    borderColor: '#FF5555',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 10,
  },
  categoryBadgeText: {
    color: '#FF5555',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 32,
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  
  // METADATA ROW
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  metaYear: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: '700',
  },
  metaBullet: {
    color: 'rgba(255, 255, 255, 0.25)',
    fontSize: 12,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 215, 0, 0.25)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  ratingStar: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: 'bold',
  },
  ratingText: {
    color: '#FFD700',
    fontSize: 11,
    fontWeight: '900',
  },
  durationContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  durationText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 10,
    fontWeight: '700',
  },

  // PLAY BUTTON
  playButton: {
    flexDirection: 'row',
    backgroundColor: '#FF5555',
    paddingVertical: 14,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
    shadowColor: '#FF5555',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  playIcon: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  playButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  
  // SECTIONS COMMON
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  overviewText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
    marginBottom: 28,
  },
  sectionContainer: {
    marginBottom: 30,
  },

  // CAST (ELENCO)
  castScroll: {
    gap: 12,
    paddingRight: 20,
  },
  actorCard: {
    width: 90,
    alignItems: 'center',
  },
  actorImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 8,
  },
  actorName: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  characterName: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 9,
    fontWeight: '500',
    textAlign: 'center',
    width: '100%',
    marginTop: 2,
  },

  // SEASONS AND EPISODES (TEMPORADAS E EPISÓDIOS)
  // SEASONS DROPDOWN SELECTOR (Pilar 1)
  seasonSelectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
  },
  seasonSelectorText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  seasonSelectorArrow: {
    color: '#FF5555',
    fontSize: 12,
    fontWeight: 'bold',
  },

  // BOTTOM SHEET MODAL PICKER (Pilar 1)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: height * 0.65,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  modalCloseButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: 'bold',
  },
  modalScroll: {
    marginBottom: 10,
  },
  modalSeasonItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 10,
  },
  modalSeasonItemActive: {
    borderColor: '#FF5555',
    backgroundColor: 'rgba(255,85,85,0.06)',
  },
  modalSeasonText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '700',
  },
  modalSeasonTextActive: {
    color: '#FF5555',
    fontWeight: '900',
  },
  modalSeasonCount: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '600',
  },
  modalSeasonCountActive: {
    color: 'rgba(255,85,85,0.6)',
  },
  episodesList: {
    gap: 12,
  },
  episodeCard: {
    flexDirection: 'row',
    backgroundColor: '#101010',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.02)',
    padding: 10,
    gap: 12,
  },
  episodeThumb: {
    width: 100,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#141414',
  },
  episodeInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  episodeNumberText: {
    color: '#FF5555',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  episodeTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  episodeOverview: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    lineHeight: 14,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 15,
  },

  // SIMILAR TITLES
  similarScroll: {
    gap: 12,
    paddingRight: 20,
  },
  similarCard: {
    width: 110,
  },
  similarPoster: {
    width: 110,
    height: 160,
    borderRadius: 12,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginBottom: 6,
  },
  similarTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    width: '100%',
  },
});
