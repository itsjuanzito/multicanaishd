import React, { useEffect, useState } from 'react';
import { Image, Text } from 'react-native';
import { SvgUri } from 'react-native-svg';

interface AvatarProps {
  url: string | null;
  initials: string;
  size: number;
  style?: any;
}

function Avatar({ url, initials, size, style }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (!url || failed) {
    return <Text style={style}>{initials}</Text>;
  }

  if (url.toLowerCase().endsWith('.svg')) {
    return (
      <SvgUri
        uri={url}
        width={size}
        height={size}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <Image
      source={{ uri: url }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      onError={() => setFailed(true)}
    />
  );
}

export default Avatar;
