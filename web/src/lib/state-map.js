export const STATE_MAP = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AS': 'American Samoa', 'AZ': 'Arizona',
    'AR': 'Arkansas', 'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut',
    'DE': 'Delaware', 'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia',
    'GU': 'Guam', 'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana',
    'IA': 'Iowa', 'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
    'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
    'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
    'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
    'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota',
    'MP': 'Northern Mariana Islands', 'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon',
    'PA': 'Pennsylvania', 'PR': 'Puerto Rico', 'RI': 'Rhode Island',
    'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
    'UT': 'Utah', 'VT': 'Vermont', 'VI': 'Virgin Islands', 'VA': 'Virginia',
    'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
};

export const STATE_ABBREV = Object.fromEntries(
    Object.entries(STATE_MAP).map(([k, v]) => [v, k])
);

export const ALT_PORTAL_VALUES = ['not available', 'UHC', 'Superior', 'Cigna', 'HPN', 'UMR', 'OptumCare'];

export const PAGE_SCHEMA_DATA = {"20554": 1, "AETNA": 2, "ABH01": 4, "WLPNT": 5, "BCBSTX": 6, "HCSV2": 7, "HUMANA": 9, "190": 8, "HMAPD": 0, "193": 0, "661": 5, "551": 0, "66003": 8, "91051": 0, "1260": 0, "46148": 0, "76498": 0, "10550": 0, "LOUISIANA%2520HEALTHCARE%2520CONNECTIONS": 10, "Superior": 11, "OTHERBLUEPLANS-TX": 0, "88221": 0, "75261": 0, "80141T": 0, "00390": 4, "00932": 9, "00430": 8, "00430F": 8, "55891": 8, "59355M": 8, "38336": 1, "A3144": 1, "A6001": 10, "IOWATOTALCARE": 10, "NEBRASKA%2520TOTAL%2520CARE": 10, "A52189": 0, "BHOVO": 0, "52189": 0, "A6014": 10, "160": 14, "A6863": 1, "DEVOT": 12, "COORDINATED%2520CARE": 10, "WCCENTENE": 10, "A8822": 15, "UHC": 17};
