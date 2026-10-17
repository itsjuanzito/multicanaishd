// src/utils/avatarPath.js
//
// Resolve o campo `avatar` do perfil para uma URL utilizável.
//
// O campo guarda duas coisas diferentes: um índice ('1'..'10') dos avatares padrão, ou a URL
// completa de um upload custom (exclusivo Diamond, vai pro storage do Supabase). A regra do
// índice também não é uniforme — de 1 a 5 são .svg, de 6 em diante .png — e essa mesma cadeia
// estava copiada em perfil.astro e ranking.astro. Comentários viraram o terceiro consumidor,
// então virou util.

const AVATAR_SVG_MAX = 5;

export function getAvatarPath(avatarId) {
    if (!avatarId) return '/avatars/avatar_1.svg';

    const raw = String(avatarId);
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        return raw;
    }

    const index = parseInt(raw, 10);
    if (!Number.isFinite(index) || index < 1) return '/avatars/avatar_1.svg';

    return index > AVATAR_SVG_MAX
        ? `/avatars/avatar_${index}.png`
        : `/avatars/avatar_${index}.svg`;
}
