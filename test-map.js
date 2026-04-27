const rows = [
  { Name: 'ahmed', email: 'ali@gmail.com', phone: 87545625, status: 'nouveau' },
  { Name: 'yousef', email: 'yo@gmail.com', phone: 44545625, status: '' }
];

const isValidEmail = (email) => {
    return email ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : false;
  }

const errors = [];
const leads = [];

rows.forEach((row, index) => {
    const keys = Object.keys(row);
    const getVal = (possibleKeys) => {
      const key = keys.find(k => possibleKeys.includes(k.toLowerCase().trim()));
      return key ? row[key]?.toString().trim() : undefined;
    };

    const email = getVal(['email', 'e-mail', 'courriel']);
    if (!isValidEmail(email)) {
      errors.push(`Row ${index}: invalid email`);
      return null;
    }

    const firstName = getVal(['firstname', 'first_name', 'prenom', 'prénom', 'name']) || undefined;
    const lastName = getVal(['lastname', 'last_name', 'nom', 'nom de famille']) || undefined;
    const phone = getVal(['phone', 'telephone', 'téléphone', 'tel']) || undefined;
    const notes = getVal(['notes', 'note', 'remarques', 'remarque']) || undefined;

    leads.push({
      firstName,
      lastName,
      email,
      phone,
      notes,
    });
})

console.log({ leads, errors });
