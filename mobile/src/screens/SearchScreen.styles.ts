import { StyleSheet, Platform, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');
const cardWidth = (width - 32 - 24) / 3; // Calculate 3 columns with margins and padding

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 45,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginRight: 12,
  },
  backButtonText: {
    fontSize: 22,
    color: '#FFFFFF',
    fontWeight: '300',
    marginTop: -2, // Optical alignment
  },
  searchInputWrapper: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 14,
  },
  searchInputWrapperActive: {
    borderColor: '#FF5555',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  searchIcon: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.5)',
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: '100%',
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    padding: 0,
  },
  clearButton: {
    padding: 4,
  },
  clearButtonText: {
    fontSize: 14,
    color: '#FF5555',
    fontWeight: 'bold',
  },
  
  // GRID LAYOUT
  gridContainer: {
    paddingHorizontal: 10,
    paddingTop: 16,
    paddingBottom: 32,
  },
  mediaCard: {
    width: cardWidth,
    margin: 6,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  posterImage: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 11,
  },
  cardGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
  },
  cardInfo: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardYear: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '600',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ratingStar: {
    fontSize: 8,
    color: '#FFD700',
    marginRight: 2,
  },
  ratingText: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },

  // EMPTY / SUGGESTION STATES
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
    paddingHorizontal: 32,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 16,
    color: 'rgba(255, 255, 255, 0.2)',
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    lineHeight: 18,
  },
  loadingIndicator: {
    marginTop: 60,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
});
