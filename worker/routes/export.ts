import type { Env } from '../index';

export const ALT_PORTAL_VALUES = ['not available', 'UHC', 'Superior', 'Cigna', 'HPN', 'UMR', 'OptumCare'];

export const STATE_ABBREV: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'American Samoa': 'AS', 'Arizona': 'AZ',
  'Arkansas': 'AR', 'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT',
  'Delaware': 'DE', 'District of Columbia': 'DC', 'Florida': 'FL', 'Georgia': 'GA',
  'Guam': 'GU', 'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN',
  'Iowa': 'IA', 'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME',
  'Maryland': 'MD', 'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
  'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE',
  'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM',
  'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  'Northern Mariana Islands': 'MP', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR',
  'Pennsylvania': 'PA', 'Puerto Rico': 'PR', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX',
  'Utah': 'UT', 'Vermont': 'VT', 'Virgin Islands': 'VI', 'Virginia': 'VA',
  'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
};

export type ExportPortal = 'availity' | 'uhc';

export function isValidPortal(s: string): s is ExportPortal {
  return s === 'availity' || s === 'uhc';
}

export async function buildAvailityExport(env: Env, clientId: number): Promise<object[]> {
  const rows = await env.DB.prepare(
    `SELECT state_name, plan_name, availity_payer_id
     FROM payer_mappings
     WHERE client_id = ? AND availity_payer_id IS NOT NULL`
  ).bind(clientId).all();

  const byPayerState: Record<string, any> = {};

  for (const row of rows.results) {
    const r = row as any;
    const payerId: string = r.availity_payer_id;
    if (ALT_PORTAL_VALUES.includes(payerId)) continue;

    const stateAbbrev = STATE_ABBREV[r.state_name] || r.state_name;
    const key = stateAbbrev + '|' + payerId;

    if (!byPayerState[key]) {
      byPayerState[key] = {
        LocationCode: stateAbbrev,
        AvailityPayerID: payerId,
        ClaimDataPageLayoutType: 1,
        Queues: [],
      };
    }

    const queueName = String(r.plan_name).trim() + ', ' + stateAbbrev;
    if (!byPayerState[key].Queues.includes(queueName)) {
      byPayerState[key].Queues.push(queueName);
    }
  }

  return Object.values(byPayerState).sort((a: any, b: any) => {
    if (a.LocationCode !== b.LocationCode) return a.LocationCode.localeCompare(b.LocationCode);
    return a.AvailityPayerID.localeCompare(b.AvailityPayerID);
  });
}

export async function buildUhcExport(env: Env, clientId: number): Promise<string[] | null> {
  const configRow = await env.DB.prepare(
    'SELECT config_json FROM portal_configs WHERE client_id = ? AND portal = ?'
  ).bind(clientId, 'UHC').first<{ config_json: string }>();

  if (!configRow) return null;

  let taxIdMap: Record<string, string>;
  try {
    taxIdMap = JSON.parse(configRow.config_json);
  } catch {
    return null;
  }

  const taxIds = Object.keys(taxIdMap);
  if (taxIds.length === 0) return null;

  const rows = await env.DB.prepare(
    `SELECT state_name, plan_name
     FROM payer_mappings
     WHERE client_id = ? AND availity_payer_id = 'UHC'`
  ).bind(clientId).all();

  const queues: string[] = [];

  for (const row of rows.results) {
    const r = row as any;
    const stateAbbrev = STATE_ABBREV[r.state_name] || r.state_name;
    const planName = String(r.plan_name).trim();

    for (const taxId of taxIds) {
      queues.push(`${planName}, ${stateAbbrev}, ${taxId}`);
    }
  }

  queues.sort();
  return queues;
}

export function downloadResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
