/**
 * Takvim aboneliği adresleri `/takvim/<token>.ics` biçimindedir; token adres yolunda olduğu için istek günlüklerine yazılmamalıdır.
 * `next.config.ts` (`logging.incomingRequests.ignore`) ve testi bu deseni paylaşır. Desen `/takvim/` önekine bağlıdır: rota taşınırsa
 * burası da değişmelidir (entegrasyon testi `takvimUrl` yolunun bu desenle eşleştiğini doğrular).
 */
export const TAKVIM_ISTEK_GUNLUGU_HARIC = /^\/takvim\//
