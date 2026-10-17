// src/utils/mobile.js

/**
 * Detects if a user agent string belongs to a mobile device.
 * @param {string} userAgent - The User-Agent header value.
 * @returns {boolean} True if mobile, false otherwise.
 */
export function isMobileUA(userAgent) {
    if (!userAgent) return false;
    return /mobile|android|iphone|ipad|phone/i.test(userAgent);
}

/**
 * Returns the optimized TMDB backdrop srcset based on mobile viewport constraint.
 * @param {string} backdropPath - TMDB backdrop path (e.g. /foo.jpg)
 * @param {boolean} isMobile - Whether the device is mobile.
 * @returns {string|null} The srcset string or null.
 */
export function getBackdropSrcset(backdropPath, isMobile) {
    if (!backdropPath) return null;
    if (isMobile) {
        return `https://image.tmdb.org/t/p/w300${backdropPath} 300w, https://image.tmdb.org/t/p/w780${backdropPath} 780w`;
    }
    return `https://image.tmdb.org/t/p/w300${backdropPath} 300w, https://image.tmdb.org/t/p/w780${backdropPath} 780w, https://image.tmdb.org/t/p/w1280${backdropPath} 1280w`;
}

/**
 * Returns the optimized TMDB backdrop preload image set for the Home page (Hero Carousel first slide).
 * @param {string} backdropPath - TMDB backdrop path (e.g. /foo.jpg)
 * @param {boolean} isMobile - Whether the device is mobile.
 * @returns {string|null} The preload image set string or null.
 */
export function getHomePreloadImageSet(backdropPath, isMobile) {
    if (!backdropPath) return null;
    if (isMobile) {
        return `https://image.tmdb.org/t/p/w300${backdropPath} 300w, https://image.tmdb.org/t/p/w780${backdropPath} 780w`;
    }
    return `https://image.tmdb.org/t/p/w300${backdropPath} 300w, https://image.tmdb.org/t/p/w780${backdropPath} 780w, https://image.tmdb.org/t/p/w1280${backdropPath} 1280w`;
}

/**
 * Returns the optimized TMDB backdrop preload image set for Detail pages (Movie / TV Series).
 * @param {string} backdropPath - TMDB backdrop path (e.g. /foo.jpg)
 * @param {boolean} isMobile - Whether the device is mobile.
 * @returns {string|null} The preload image set string or null.
 */
export function getDetailPreloadImageSet(backdropPath, isMobile) {
    if (!backdropPath) return null;
    if (isMobile) {
        return `https://image.tmdb.org/t/p/w780${backdropPath} 780w`;
    }
    return `https://image.tmdb.org/t/p/w780${backdropPath} 780w, https://image.tmdb.org/t/p/w1280${backdropPath} 1280w`;
}

/**
 * Returns sizes attribute based on mobile viewport constraint.
 * @param {boolean} isMobile - Whether the device is mobile.
 * @returns {string} The sizes attribute value.
 */
export function getBackdropSizes(isMobile) {
    return isMobile ? "100vw" : "(max-width: 768px) 100vw, 1280px";
}
