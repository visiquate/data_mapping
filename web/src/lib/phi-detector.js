const PHI_PATTERNS = [
    'firstname', 'lastname', 'name', 'dob', 'dateofbirth', 'birthdate', 'ssn', 'socialsecurity',
    'memberid', 'subscriberid', 'patientid', 'address', 'street', 'city', 'zip', 'zipcode',
    'phone', 'email', 'diagnosis', 'dx', 'icd', 'cpt', 'procedure', 'claim', 'claimid',
    'claimnumber', 'provider', 'npi', 'group', 'groupid', 'groupname', 'employer',
    'policyno', 'policynumber', 'accountno', 'mrn', 'medicalrecord', 'patientname',
    'membername', 'subscribername', 'insuredname', 'dependent'
];

const ALLOWED_COLS = ['state', 'payer1', 'payer', 'volume'];

export function detectPHIColumns(data) {
    if (!data.length) return [];
    const found = [];

    Object.keys(data[0]).forEach(col => {
        const normalized = col.toLowerCase().replace(/[\s_-]/g, '');
        if (ALLOWED_COLS.includes(normalized)) return;
        if (PHI_PATTERNS.some(p => normalized.includes(p))) found.push(col);
    });

    // Reject files with too many columns (expected: 2-3 for a summary file)
    const colCount = Object.keys(data[0]).length;
    if (colCount > 5 && found.length === 0) {
        found.push('(' + colCount + ' columns detected — expected 2-3 for a summary file)');
    }

    return found;
}
