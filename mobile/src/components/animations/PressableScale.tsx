// mobile/src/components/animations/PressableScale.tsx
import React from 'react';
import { TouchableOpacity, TouchableOpacityProps, ViewStyle, StyleProp } from 'react-native';

interface PressableScaleProps extends TouchableOpacityProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
}

/**
 * Wrapper fino sobre TouchableOpacity — mantido só para não precisar tocar em
 * todo componente que já importa <PressableScale>. Sem animação (Reanimated
 * removido: pesava demais em conjunto com o carregamento pesado da Home).
 */
function PressableScale({ children, style, scaleTo, ...rest }: PressableScaleProps) {
  return (
    <TouchableOpacity style={style} activeOpacity={0.8} {...rest}>
      {children}
    </TouchableOpacity>
  );
}

export default PressableScale;
