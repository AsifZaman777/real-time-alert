import React, { useMemo } from "react";
import {
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GoldAlert } from "../types/alert";
import { VeracityMeter } from "./VeracityMeter";
import { formatEventLabel, formatNewsTimestamp } from "../services/notifications";

interface AreaDetailModalProps {
  visible: boolean;
  areaName: string | null;
  alerts: GoldAlert[];
  onClose: () => void;
}

export const AreaDetailModal: React.FC<AreaDetailModalProps> = ({
  visible,
  areaName,
  alerts,
  onClose,
}) => {
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
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.kicker}>AREA THREAT & DISRUPTION INTEL</Text>
              <Text style={styles.title}>{areaName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color="#E2E8F0" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {sortedAlerts.length === 0 ? (
              <Text style={styles.empty}>
                No active threat or disruption alerts recorded for {areaName}.
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
                            backgroundColor: isRed
                              ? "rgba(239,68,68,0.18)"
                              : "rgba(245,158,11,0.18)",
                          },
                        ]}
                      >
                        <Text style={[styles.eventPillText, { color: cluster.color }]}>
                          {formatEventLabel(cluster.event_type).toUpperCase()} •{" "}
                          {cluster.severity}
                        </Text>
                      </View>
                      {cluster.on_route && (
                        <View style={styles.routeBadge}>
                          <Text style={styles.routeBadgeText}>ON YOUR ROUTE</Text>
                        </View>
                      )}
                    </View>

                    {cluster._newestTs ? (
                      <View style={styles.clusterTimeRow}>
                        <Ionicons name="time-outline" size={12} color="#38BDF8" />
                        <Text style={styles.clusterTimeText}>
                          Latest report: {formatNewsTimestamp(cluster._newestTs)}
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
                      Recent Reports — Newest First ({cluster.articles.length})
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
                              <Text style={styles.latestBadgeText}>LATEST</Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.articleHeadline}>{art.headline}</Text>

                        <View style={styles.publishTimeRow}>
                          <Ionicons
                            name="calendar-outline"
                            size={11}
                            color="#94A3B8"
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
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5, 8, 18, 0.78)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#0E1525",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "84%",
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  kicker: {
    color: "#38BDF8",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  title: {
    color: "#F8FAFC",
    fontSize: 22,
    fontWeight: "800",
  },
  closeBtn: {
    backgroundColor: "#1E293B",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  scroll: {
    flexGrow: 0,
  },
  empty: {
    color: "#94A3B8",
    textAlign: "center",
    paddingVertical: 24,
  },
  clusterCard: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1F2937",
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
    color: "#7DD3FC",
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
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    borderColor: "#EF4444",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  routeBadgeText: {
    color: "#FCA5A5",
    fontSize: 10,
    fontWeight: "800",
  },
  headlinesTitle: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  articleRow: {
    backgroundColor: "#0F172A",
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#1E293B",
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
    color: "#38BDF8",
    fontSize: 11,
    fontWeight: "700",
  },
  articleLang: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
    backgroundColor: "#1E293B",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  latestBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.18)",
    borderColor: "#10B981",
    borderWidth: 0.8,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  latestBadgeText: {
    color: "#34D399",
    fontSize: 9,
    fontWeight: "800",
  },
  articleHeadline: {
    color: "#F1F5F9",
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
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "500",
  },
});
