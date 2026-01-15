#!/usr/bin/env node
// CLI tool to analyze tone correction metrics

import { analyzeToneMetrics, formatReportAsMarkdown, compareTimePeriods } from '../src/work/analysis/tone-metrics.js';
import { readToneCorrectionLogs } from '../src/work/storage/metrics.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'report';
  
  try {
    switch (command) {
      case 'report':
        await generateReport(args);
        break;
      
      case 'compare':
        await compareReports(args);
        break;
      
      case 'raw':
        await showRawLogs(args);
        break;
      
      case 'help':
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function generateReport(args: string[]) {
  console.log('Analyzing tone correction metrics...\n');
  
  // Parse optional date range
  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  
  const fromIndex = args.indexOf('--from');
  if (fromIndex !== -1 && args[fromIndex + 1]) {
    fromDate = new Date(args[fromIndex + 1]);
  }
  
  const toIndex = args.indexOf('--to');
  if (toIndex !== -1 && args[toIndex + 1]) {
    toDate = new Date(args[toIndex + 1]);
  }
  
  const report = await analyzeToneMetrics(fromDate, toDate);
  const markdown = formatReportAsMarkdown(report);
  
  console.log(markdown);
  
  // Save to file if --output specified
  const outputIndex = args.indexOf('--output');
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    const outputPath = args[outputIndex + 1];
    await writeFile(outputPath, markdown);
    console.log(`\n✅ Report saved to: ${outputPath}`);
  } else {
    // Default save location
    const defaultPath = join(process.cwd(), 'WORK_DIRS', 'metrics', 'tone-report.md');
    await writeFile(defaultPath, markdown);
    console.log(`\n✅ Report saved to: ${defaultPath}`);
  }
}

async function compareReports(args: string[]) {
  const baselineFromIndex = args.indexOf('--baseline-from');
  const baselineToIndex = args.indexOf('--baseline-to');
  const currentFromIndex = args.indexOf('--current-from');
  const currentToIndex = args.indexOf('--current-to');
  
  if (baselineFromIndex === -1 || baselineToIndex === -1 || 
      currentFromIndex === -1 || currentToIndex === -1) {
    console.error('Error: compare command requires --baseline-from, --baseline-to, --current-from, --current-to');
    console.error('Example: npm run analyze:tone compare --baseline-from 2025-01-01 --baseline-to 2025-01-07 --current-from 2025-01-08 --current-to 2025-01-14');
    process.exit(1);
  }
  
  const baseline = {
    from: new Date(args[baselineFromIndex + 1]),
    to: new Date(args[baselineToIndex + 1]),
  };
  
  const current = {
    from: new Date(args[currentFromIndex + 1]),
    to: new Date(args[currentToIndex + 1]),
  };
  
  console.log('Comparing time periods...\n');
  
  const comparison = await compareTimePeriods(baseline, current);
  
  console.log('# Tone Corrections Comparison\n');
  console.log('## Baseline Period');
  console.log(`${baseline.from.toISOString().split('T')[0]} to ${baseline.to.toISOString().split('T')[0]}`);
  console.log(`- Average iterations: ${comparison.baseline.averageIterations.toFixed(2)}`);
  console.log(`- Total corrections: ${comparison.baseline.draftsWithCorrections}\n`);
  
  console.log('## Current Period');
  console.log(`${current.from.toISOString().split('T')[0]} to ${current.to.toISOString().split('T')[0]}`);
  console.log(`- Average iterations: ${comparison.current.averageIterations.toFixed(2)}`);
  console.log(`- Total corrections: ${comparison.current.draftsWithCorrections}\n`);
  
  console.log('## Improvement');
  if (comparison.improvement.iterationReduction > 0) {
    console.log(`✅ Iteration reduction: ${comparison.improvement.iterationReduction.toFixed(1)}%`);
  } else if (comparison.improvement.iterationReduction < 0) {
    console.log(`⚠️  Iterations increased: ${Math.abs(comparison.improvement.iterationReduction).toFixed(1)}%`);
  } else {
    console.log('No change in iterations');
  }
}

async function showRawLogs(args: string[]) {
  const logs = await readToneCorrectionLogs();
  
  if (logs.length === 0) {
    console.log('No tone correction logs found.');
    return;
  }
  
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 && args[limitIndex + 1] 
    ? parseInt(args[limitIndex + 1], 10) 
    : 50;
  
  console.log(`Showing last ${Math.min(limit, logs.length)} tone corrections:\n`);
  
  const recentLogs = logs.slice(-limit);
  
  for (const log of recentLogs) {
    const date = new Date(log.timestamp).toISOString();
    console.log(`[${date}] Conversation: ${log.conversationId}`);
    console.log(`  Category: ${log.category} | Iteration: ${log.iterationNumber}`);
    console.log(`  User: "${log.userCorrection}"`);
    console.log(`  Draft: "${log.assistantResponse.substring(0, 100)}..."`);
    console.log('');
  }
  
  console.log(`Total logs: ${logs.length}`);
}

function showHelp() {
  console.log(`
Tone Correction Metrics Analyzer

Usage:
  npm run analyze:tone [command] [options]

Commands:
  report            Generate a metrics report (default)
  compare           Compare two time periods
  raw               Show raw log entries
  help              Show this help message

Options for 'report':
  --from DATE       Filter logs from this date (YYYY-MM-DD)
  --to DATE         Filter logs to this date (YYYY-MM-DD)
  --output PATH     Save report to custom path

Examples:
  npm run analyze:tone
  npm run analyze:tone report --from 2025-01-01 --to 2025-01-31
  npm run analyze:tone report --output ./my-report.md
  npm run analyze:tone raw --limit 20

Options for 'compare':
  --baseline-from DATE    Baseline period start
  --baseline-to DATE      Baseline period end
  --current-from DATE     Current period start
  --current-to DATE       Current period end

Examples:
  npm run analyze:tone compare --baseline-from 2025-01-01 --baseline-to 2025-01-07 --current-from 2025-01-08 --current-to 2025-01-14

Options for 'raw':
  --limit N         Show last N entries (default: 50)
`);
}

main();



