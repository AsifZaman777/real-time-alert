import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GoldAlert } from "../types/alert";
import { VeracityMeter } from "./VeracityMeter";
import { formatNewsTimestamp } from "../services/notifications";
import { useI18n } from "../i18n";

interface AreaDetailModalProps {
  visible: boolean;
  areaName: string | null;
  alerts: GoldAlert[];
  onCrowdVote?: (area: string, eventType: string, vote: "confirm" | "clear") => void;
  onClose: () => void;
}

export const AreaDetailModal: React.FC<AreaDetailModalProps> = ({
  visible,
  areaName,
  alerts,
  onCrowdVote,
  onClose,
}) => {
  const { t, tEvent, tSeverity } = useI18n();
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
    }
  }, [visible, areaName, translateY]);

  const dismissWithAnimation = () => {
    Animated.timing(translateY, {
      toValue: 520,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  // Drag handle gesture: drag downwards to close ("drag to off")
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
        onPanResponderMove: (_, g) => {
          if (g.dy > 0) {
            translateY.setValue(g.dy);
          } else {
            translateY.setValue(g.dy * 0.18);
          }
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > 85 || g.vy > 0.55) {
            dismissWithAnimation();
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 5,
            }).start();
          }
        },
      }),
    [onClose]
  );

  // Sort clusters and their articles so the most recent news is always at the top
  const sortedAlerts = useMemo(() => {
    return [...alerts]
      .map((cluster) => {
        const sortedArticles = [...(cluster.articles || [])].sort((a, b) => {
          const tsA = a.published || a.ingested_at || "";
          const tsB = b.published || b.ingested_at || "";
          return tsB.localeCompare(tsA);
        });
        const newestTs =
          sortedArticles[0]?.published ||
          sortedArticles[0]?.ingested_at ||
          cluster.last_updated ||
          "";
        return {
          ...cluster,
          articles: sortedArticles,
          _newestTs: newestTs,
        };
      })
      .sort((a, b) => b._newestTs.localeCompare(a._newestTs));
  }, [alerts]);

  if (!areaName) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissWithAnimation} />
        <Animated.View
          style={[
            styles.sheet,
            {
              transform: [{ translateY }],
            },
          ]}
        >
          {/* Draggable Top Handle Area (Drag down to close) */}
          <View {...panResponder.panHandlers} style={styles.dragHandleArea}>
            <View style={styles.dragHandlePill} />
            <Text style={styles.dragHint}>{t("dragDownClose")}</Text>
          </View>

          <View style={styles.header}>
            <View style={styles.headerTextCol}>
              <Text style={styles.kicker}>{t("areaIntel")}</Text>
              <View style={styles.titleRow}>
                <Ionicons name="location" size={20} color="#EA4335" />
                <Text style={styles.title}>{areaName}</Text>
              </View>
            </View>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {sortedAlerts.length === 0 ? (
              <Text style={styles.empty}>
                {t("noAreaAlerts", { area: areaName })}
              </Text>
            ) : (
              sortedAlerts.map((cluster) => {
                const isRed = cluster.color === "#EF4444";
                return (
                  <View
                    key={cluster.cluster_id}
                    style={[
                      styles.clusterCard,
                      { borderLeftColor: cluster.color, borderLeftWidth: 4 },
                    ]}
                  >
                    <View style={styles.clusterHeader}>
                      <View
                        style={[
                          styles.eventPill,
                          {
                            backgroundColor: isRed ? "#FEE2E2" : "#FEF3C7",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.eventPillText,
                            { color: isRed ? "#DC2626" : "#D97706" },
                          ]}
                        >
                          {tEvent(cluster.event_type)} • {tSeverity(cluster.severity)}
                        </Text>
                      </View>
                      {cluster.on_route && (
                        <View style={styles.routeBadge}>
                          <Text style={styles.routeBadgeText}>{t("onRouteBadge")}</Text>
                        </View>
                      )}
                    </View>

                    {cluster._newestTs ? (
                      <View style={styles.clusterTimeRow}>
                        <Ionicons name="time-outline" size={12} color="#1A73E8" />
                        <Text style={styles.clusterTimeText}>
                          {t("latestReport")}: {formatNewsTimestamp(cluster._newestTs)}
                        </Text>
                      </View>
                    ) : null}

                    <VeracityMeter
                      veracityPercent={cluster.veracity_percent}
                      credibilityScore={cluster.credibility_score}
                      veracityStatus={cluster.veracity_status}
                      veracitySummary={cluster.veracity_summary}
                      sources={cluster.sources}
                    />

                    <Text style={styles.headlinesTitle}>
                      {t("recentReports", { count: cluster.articles.length })}
                    </Text>

                    {cluster.articles.map((art, idx) => (
                      <TouchableOpacity
                        key={`${cluster.cluster_id}-${idx}`}
                        style={styles.articleRow}
                        onPress={() => {
                          if (art.url) Linking.openURL(art.url).catch(() => {});
                        }}
                      >
                        <View style={styles.articleMeta}>
                          <View style={styles.sourceWrap}>
                            <Text style={styles.articleSource}>{art.source}</Text>
                            <Text style={styles.articleLang}>
                              {art.lang?.toUpperCase()}
                            </Text>
                          </View>
                          {idx === 0 && (
                            <View style={styles.latestBadge}>
                              <Text style={styles.latestBadgeText}>{t("latestTag")}</Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.articleHeadline}>{art.headline}</Text>

                        <View style={styles.publishTimeRow}>
                          <Ionicons
                            name="calendar-outline"
                            size={11}
                            color="#64748B"
                          />
                          <Text style={styles.publishTimeText}>
                            {formatNewsTimestamp(art.published, art.ingested_at)}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "84%",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 16,
  },
  dragHandleArea: {
    alignItems: "center",
    paddingVertical: 8,
  },
  dragHandlePill: {
    width: 42,
    height: 4.5,
    borderRadius: 999,
    backgroundColor: "#CBD5E1",
    marginBottom: 4,
  },
  dragHint: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  headerTextCol: {
    flex: 1,
  },
  kicker: {
    color: "#1A73E8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  title: {
    color: "#0F172A",
    fontSize: 21,
    fontWeight: "800",
  },
  closeBtn: {
    backgroundColor: "#F1F5F9",
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flexGrow: 0,
  },
  empty: {
    color: "#64748B",
    textAlign: "center",
    paddingVertical: 24,
  },
  clusterCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  clusterHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  clusterTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  clusterTimeText: {
    color: "#1A73E8",
    fontSize: 11,
    fontWeight: "600",
  },
  eventPill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  eventPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  routeBadge: {
    backgroundColor: "#FEE2E2",
    borderColor: "#EF4444",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  routeBadgeText: {
    color: "#DC2626",
    fontSize: 10,
    fontWeight: "800",
  },
  headlinesTitle: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  articleRow: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  articleMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sourceWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  articleSource: {
    color: "#1A73E8",
    fontSize: 11,
    fontWeight: "700",
  },
  articleLang: {
    color: "#475569",
    fontSize: 10,
    fontWeight: "700",
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  latestBadge: {
    backgroundColor: "#DCFCE7",
    borderColor: "#10B981",
    borderWidth: 0.8,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  latestBadgeText: {
    color: "#15803D",
    fontSize: 9,
    fontWeight: "800",
  },
  articleHeadline: {
    color: "#0F172A",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  publishTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  publishTimeText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "500",
  },
});
