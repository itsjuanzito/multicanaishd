import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  section: {
    marginTop: 28,
    marginBottom: 6,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
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
  
  // TOP 10 WEEK CARDS STYLES (MEDIDAS CORRIGIDAS EXATAMENTE IGUAIS AS OUTRAS SEÇÕES)
  top10List: {
    paddingRight: 20,
    paddingVertical: 4,
  },
  top10Card: {
    width: 190, // Aumentado ligeiramente para comportar o poster de 135px + margem
    height: 205, // Aumentado para comportar o poster de 190px de altura perfeitamente
    position: 'relative',
    marginRight: 10,
  },
  top10Number: {
    fontSize: 135,
    fontWeight: '900',
    fontStyle: 'italic',
    color: 'rgba(255, 255, 255, 0.18)', 
    position: 'absolute',
    left: 0,
    bottom: -10, // Perfeitamente alinhado com a base sem cortes zoados
    zIndex: 1,
    letterSpacing: -10,
  },
  top10PosterContainer: {
    width: 135,  // EXATAMENTE IGUAL AS OUTRAS SEÇÕES
    height: 190, // EXATAMENTE IGUAL AS OUTRAS SEÇÕES
    borderRadius: 18, // EXATAMENTE IGUAL AS OUTRAS SEÇÕES
    overflow: 'hidden',
    position: 'absolute',
    left: 50, // Deslocamento perfeito para a direita gerando a sobreposição 3D ideal
    bottom: 5,
    zIndex: 2,
    backgroundColor: '#141414',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  top10Poster: {
    width: '100%',
    height: '100%',
  },
  top10Badge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(5, 5, 5, 0.82)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    zIndex: 10,
  },
  top10BadgeText: {
    color: '#FFEC3D',
    fontSize: 9,
    fontWeight: '900',
  },
  top10PosterGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 60,
    zIndex: 3,
  },
  top10Title: {
    position: 'absolute',
    bottom: 12,
    left: 10,
    right: 10,
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    zIndex: 4,
  },
});
