// Analysis and reporting for tone correction metrics

import { ToneCorrectionLog, ToneCorrectionCategory, readToneCorrectionLogs } from '../storage/metrics.js';

// ===== ANALYSIS TYPES =====

export interface ToneMetricsReport {
  totalDrafts: number;
  draftsWithCorrections: number;
  correctionRate: number; // percentage
  averageIterations: number;
  categoryBreakdown: Record<ToneCorrectionCategory, number>;
  commonPatterns: Array<{ pattern: string; count: number }>;
  timeRange: {
    from: string;
    to: string;
  };
  trendByWeek?: Array<{
    week: string;
    avgIterations: number;
    correctionCount: number;
  }>;
}

// ===== ANALYSIS FUNCTIONS =====

/**
 * Analyze all tone correction logs
 */
export async function analyzeToneMetrics(
  fromDate?: Date,
  toDate?: Date
): Promise<ToneMetricsReport> {
  const logs = await readToneCorrectionLogs();
  
  // Filter by date range if provided
  const filteredLogs = logs.filter(log => {
    if (fromDate && log.timestamp < fromDate.getTime()) return false;
    if (toDate && log.timestamp > toDate.getTime()) return false;
    return true;
  });
  
  if (filteredLogs.length === 0) {
    return {
      totalDrafts: 0,
      draftsWithCorrections: 0,
      correctionRate: 0,
      averageIterations: 0,
      categoryBreakdown: {
        formality: 0,
        brevity: 0,
        style: 0,
        greeting: 0,
      },
      commonPatterns: [],
      timeRange: {
        from: 'N/A',
        to: 'N/A',
      },
    };
  }
  
  // Group by conversation to get unique draft sessions
  const conversationMap = new Map<string, ToneCorrectionLog[]>();
  for (const log of filteredLogs) {
    if (!conversationMap.has(log.conversationId)) {
      conversationMap.set(log.conversationId, []);
    }
    conversationMap.get(log.conversationId)!.push(log);
  }
  
  // Calculate metrics
  const draftsWithCorrections = conversationMap.size;
  const totalCorrections = filteredLogs.length;
  const averageIterations = totalCorrections / draftsWithCorrections;
  
  // Category breakdown
  const categoryBreakdown: Record<ToneCorrectionCategory, number> = {
    formality: 0,
    brevity: 0,
    style: 0,
    greeting: 0,
  };
  
  for (const log of filteredLogs) {
    categoryBreakdown[log.category]++;
  }
  
  // Common patterns (extract key phrases from user corrections)
  const patternCounts = new Map<string, number>();
  for (const log of filteredLogs) {
    // Simple extraction - lowercase first 50 chars
    const pattern = log.userCorrection.toLowerCase().substring(0, 50);
    patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
  }
  
  const commonPatterns = Array.from(patternCounts.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Top 10
  
  // Time range
  const timestamps = filteredLogs.map(log => log.timestamp).sort((a, b) => a - b);
  const timeRange = {
    from: new Date(timestamps[0]).toISOString(),
    to: new Date(timestamps[timestamps.length - 1]).toISOString(),
  };
  
  // Weekly trend (if enough data)
  const trendByWeek = calculateWeeklyTrend(filteredLogs);
  
  return {
    totalDrafts: draftsWithCorrections, // Each conversation = one draft attempt
    draftsWithCorrections,
    correctionRate: 100, // All logged events are corrections
    averageIterations,
    categoryBreakdown,
    commonPatterns,
    timeRange,
    trendByWeek: trendByWeek.length > 0 ? trendByWeek : undefined,
  };
}

/**
 * Calculate weekly trend of corrections
 */
function calculateWeeklyTrend(logs: ToneCorrectionLog[]): Array<{
  week: string;
  avgIterations: number;
  correctionCount: number;
}> {
  if (logs.length === 0) return [];
  
  // Group by week
  const weekMap = new Map<string, ToneCorrectionLog[]>();
  
  for (const log of logs) {
    const date = new Date(log.timestamp);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
    weekStart.setHours(0, 0, 0, 0);
    
    const weekKey = weekStart.toISOString().split('T')[0];
    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, []);
    }
    weekMap.get(weekKey)!.push(log);
  }
  
  // Calculate metrics per week
  const trend = Array.from(weekMap.entries()).map(([week, weekLogs]) => {
    const conversationIds = new Set(weekLogs.map(log => log.conversationId));
    const avgIterations = weekLogs.length / conversationIds.size;
    
    return {
      week,
      avgIterations,
      correctionCount: weekLogs.length,
    };
  });
  
  // Sort by week
  trend.sort((a, b) => a.week.localeCompare(b.week));
  
  return trend;
}

/**
 * Format report as markdown
 */
export function formatReportAsMarkdown(report: ToneMetricsReport): string {
  const lines: string[] = [
    '# Tone Corrections Analysis',
    '',
    `**Analysis Period:** ${report.timeRange.from} to ${report.timeRange.to}`,
    '',
    '## Summary',
    '',
    `- **Total drafts analyzed:** ${report.totalDrafts}`,
    `- **Drafts requiring corrections:** ${report.draftsWithCorrections}`,
    `- **Average iterations per draft:** ${report.averageIterations.toFixed(2)}`,
    '',
    '## Category Breakdown',
    '',
  ];
  
  const totalCorrections = Object.values(report.categoryBreakdown).reduce((a, b) => a + b, 0);
  
  for (const [category, count] of Object.entries(report.categoryBreakdown)) {
    const percentage = totalCorrections > 0 ? ((count / totalCorrections) * 100).toFixed(1) : '0';
    lines.push(`- **${category}:** ${count} (${percentage}%)`);
  }
  
  lines.push('', '## Common Correction Patterns', '');
  
  if (report.commonPatterns.length > 0) {
    for (const { pattern, count } of report.commonPatterns) {
      lines.push(`- "${pattern}" (${count} times)`);
    }
  } else {
    lines.push('*No patterns found*');
  }
  
  if (report.trendByWeek && report.trendByWeek.length > 1) {
    lines.push('', '## Trend Over Time', '');
    
    for (const { week, avgIterations, correctionCount } of report.trendByWeek) {
      lines.push(`- **Week of ${week}:** ${avgIterations.toFixed(2)} avg iterations (${correctionCount} corrections)`);
    }
    
    // Calculate improvement
    const firstWeek = report.trendByWeek[0];
    const lastWeek = report.trendByWeek[report.trendByWeek.length - 1];
    const improvement = ((firstWeek.avgIterations - lastWeek.avgIterations) / firstWeek.avgIterations) * 100;
    
    if (improvement > 0) {
      lines.push('', `**Improvement:** ${improvement.toFixed(1)}% reduction in iterations ✓`);
    } else if (improvement < 0) {
      lines.push('', `**Trend:** ${Math.abs(improvement).toFixed(1)}% increase in iterations`);
    }
  }
  
  return lines.join('\n');
}

/**
 * Compare two time periods
 */
export async function compareTimePeriods(
  baseline: { from: Date; to: Date },
  current: { from: Date; to: Date }
): Promise<{
  baseline: ToneMetricsReport;
  current: ToneMetricsReport;
  improvement: {
    iterationReduction: number; // percentage
    correctionRateChange: number; // percentage points
  };
}> {
  const baselineReport = await analyzeToneMetrics(baseline.from, baseline.to);
  const currentReport = await analyzeToneMetrics(current.from, current.to);
  
  const iterationReduction = baselineReport.averageIterations > 0
    ? ((baselineReport.averageIterations - currentReport.averageIterations) / baselineReport.averageIterations) * 100
    : 0;
  
  const correctionRateChange = currentReport.correctionRate - baselineReport.correctionRate;
  
  return {
    baseline: baselineReport,
    current: currentReport,
    improvement: {
      iterationReduction,
      correctionRateChange,
    },
  };
}



