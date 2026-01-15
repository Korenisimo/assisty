// FireHydrant API Client - READ ONLY
// Uses FIREHYDRANT_API_KEY

import { FireHydrantIncident, FireHydrantAlert } from '../types.js';

function getApiKey(): string {
  const apiKey = process.env.FIREHYDRANT_API_KEY;
  if (!apiKey) {
    throw new Error('FIREHYDRANT_API_KEY not found in environment');
  }
  return apiKey;
}

async function firehydrantFetch(endpoint: string): Promise<unknown> {
  const apiKey = getApiKey();
  
  const response = await fetch(`https://api.firehydrant.io/v1${endpoint}`, {
    method: 'GET', // READ ONLY
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`FireHydrant API error (${response.status}): ${errorText}`);
  }
  
  return response.json();
}

export async function searchIncidents(query: string, maxResults: number = 20): Promise<FireHydrantIncident[]> {
  try {
    const params = new URLSearchParams({
      query,
      per_page: maxResults.toString(),
    });
    
    const data = await firehydrantFetch(`/incidents?${params}`) as {
      data: Array<{
        id: string;
        name: string;
        summary?: string;
        severity?: string;
        current_milestone?: string;
        created_at: string;
        started_at?: string;
        resolved_at?: string;
        services?: Array<{ name: string }>;
        environments?: Array<{ name: string }>;
      }>;
    };
    
    return data.data.map(incident => ({
      id: incident.id,
      name: incident.name,
      summary: incident.summary,
      severity: incident.severity || 'unknown',
      currentMilestone: incident.current_milestone || 'unknown',
      createdAt: incident.created_at,
      startedAt: incident.started_at,
      resolvedAt: incident.resolved_at,
      services: incident.services?.map(s => s.name) || [],
      environments: incident.environments?.map(e => e.name) || [],
    }));
  } catch {
    return [];
  }
}

export async function getIncident(incidentId: string): Promise<FireHydrantIncident | null> {
  try {
    const data = await firehydrantFetch(`/incidents/${incidentId}`) as {
      id: string;
      name: string;
      summary?: string;
      severity?: string;
      current_milestone?: string;
      created_at: string;
      started_at?: string;
      resolved_at?: string;
      services?: Array<{ name: string }>;
      environments?: Array<{ name: string }>;
    };
    
    return {
      id: data.id,
      name: data.name,
      summary: data.summary,
      severity: data.severity || 'unknown',
      currentMilestone: data.current_milestone || 'unknown',
      createdAt: data.created_at,
      startedAt: data.started_at,
      resolvedAt: data.resolved_at,
      services: data.services?.map(s => s.name) || [],
      environments: data.environments?.map(e => e.name) || [],
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

export async function getRecentIncidents(maxResults: number = 10): Promise<FireHydrantIncident[]> {
  try {
    const data = await firehydrantFetch(`/incidents?per_page=${maxResults}`) as {
      data: Array<{
        id: string;
        name: string;
        summary?: string;
        severity?: string;
        current_milestone?: string;
        created_at: string;
        started_at?: string;
        resolved_at?: string;
        services?: Array<{ name: string }>;
        environments?: Array<{ name: string }>;
      }>;
    };
    
    return data.data.map(incident => ({
      id: incident.id,
      name: incident.name,
      summary: incident.summary,
      severity: incident.severity || 'unknown',
      currentMilestone: incident.current_milestone || 'unknown',
      createdAt: incident.created_at,
      startedAt: incident.started_at,
      resolvedAt: incident.resolved_at,
      services: incident.services?.map(s => s.name) || [],
      environments: incident.environments?.map(e => e.name) || [],
    }));
  } catch {
    return [];
  }
}

export async function getAlerts(incidentId?: string, maxResults: number = 20): Promise<FireHydrantAlert[]> {
  try {
    let endpoint = `/alerts?per_page=${maxResults}`;
    if (incidentId) {
      endpoint = `/incidents/${incidentId}/alerts?per_page=${maxResults}`;
    }
    
    const data = await firehydrantFetch(endpoint) as {
      data: Array<{
        id: string;
        summary?: string;
        status?: string;
        created_at: string;
        incident_id?: string;
      }>;
    };
    
    return data.data.map(alert => ({
      id: alert.id,
      summary: alert.summary || 'No summary',
      status: alert.status || 'unknown',
      createdAt: alert.created_at,
      incidentId: alert.incident_id,
    }));
  } catch {
    return [];
  }
}

export function isFireHydrantConfigured(): boolean {
  return !!process.env.FIREHYDRANT_API_KEY;
}

