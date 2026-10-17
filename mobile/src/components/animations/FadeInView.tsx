// mobile/src/components/animations/FadeInView.tsx
import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';

interface FadeInViewProps {
  children: React.ReactNode;
  index?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Sem animação de entrada por seção: com ~13 seções na Home disparando fetch
 * pesado (TMDB, canais, EPG) ao mesmo tempo, a cascata de "entering" pesava
 * demais em aparelhos mais fracos/Expo Go em modo debug. Mantido como wrapper
 * só pra não precisar tocar em todo componente que já usa <FadeInView>.
 */
function FadeInView({ children, style }: FadeInViewProps) {
  return <View style={style}>{children}</View>;
}

export default FadeInView;
