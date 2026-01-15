// Datadog context - loaded when datadog is enabled

export const datadogContext = `
=== DATADOG QUERY TIPS ===

1. START BROAD, then narrow:
   - First: "service:identity-service"
   - Then: "service:identity-service status:error"
   - Then add env if needed

2. Use EXACT environment names from alerts (e.g., "staging-us-east-1" NOT "staging")

3. Common fields: service, env, status, host, @http.status_code, @error.message

TIME RANGES (CRITICAL):
- Default is last 24 hours - WRONG FOR OLD ALERTS
- Extract alert timestamp and pass from/to parameters
- Use 1-2 hour window around alert time
- Example: Alert at 2025-12-16T07:08:00Z → from: "2025-12-16T06:00:00Z", to: "2025-12-16T09:00:00Z"

SMART SEARCHING:
- search_and_save_logs won't save empty results
- datadog_multi_search runs multiple queries at once
- Each search creates timestamped file in logs/

LOG ANALYSIS (CRITICAL - USE THIS):
- After saving logs, IMMEDIATELY use analyze_logs_structured tool
- Don't manually read log files or calculate timestamps
- analyze_logs_structured extracts: request rates, durations, status codes, top endpoints
- Look for structured data in logs: duration, statusCode, path, method, timestamps
- Example: analyze_logs_structured("TARGET_SERVICE_LOAD_ANALYSIS/logs/service_requests.json")

DON'T:
- Search without from/to for historical alerts
- Keep retrying same failed query
- Manually calculate request rates from timestamps - use analyze_logs_structured
- Read huge log files line by line - use structured analysis tool
`;


