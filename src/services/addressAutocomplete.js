function normalizeSuggestion(item) {
  const address = item.address || {};

  return {
    label: item.display_name,
    addressLine1: [address.house_number, address.road].filter(Boolean).join(' ').trim(),
    city: address.city || address.town || address.village || address.hamlet || '',
    stateOrProvinceCode: address.state_code || abbreviateState(address.state),
    postalCode: address.postcode || '',
    countryCode: address.country_code ? address.country_code.toUpperCase() : 'US',
  };
}

export async function searchAddressSuggestions(query) {
  const endpoint = import.meta.env.VITE_ADDRESS_AUTOCOMPLETE_URL;

  if (!endpoint) {
    return [];
  }

  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'us');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Address autocomplete is unavailable right now.');
  }

  const data = await response.json();
  return data.map(normalizeSuggestion).filter((item) => item.addressLine1 && item.city);
}

function abbreviateState(stateName) {
  const states = {
    Alabama: 'AL',
    Alaska: 'AK',
    Arizona: 'AZ',
    Arkansas: 'AR',
    California: 'CA',
    Colorado: 'CO',
    Connecticut: 'CT',
    Delaware: 'DE',
    Florida: 'FL',
    Georgia: 'GA',
    Hawaii: 'HI',
    Idaho: 'ID',
    Illinois: 'IL',
    Indiana: 'IN',
    Iowa: 'IA',
    Kansas: 'KS',
    Kentucky: 'KY',
    Louisiana: 'LA',
    Maine: 'ME',
    Maryland: 'MD',
    Massachusetts: 'MA',
    Michigan: 'MI',
    Minnesota: 'MN',
    Mississippi: 'MS',
    Missouri: 'MO',
    Montana: 'MT',
    Nebraska: 'NE',
    Nevada: 'NV',
    'New Hampshire': 'NH',
    'New Jersey': 'NJ',
    'New Mexico': 'NM',
    'New York': 'NY',
    'North Carolina': 'NC',
    'North Dakota': 'ND',
    Ohio: 'OH',
    Oklahoma: 'OK',
    Oregon: 'OR',
    Pennsylvania: 'PA',
    'Rhode Island': 'RI',
    'South Carolina': 'SC',
    'South Dakota': 'SD',
    Tennessee: 'TN',
    Texas: 'TX',
    Utah: 'UT',
    Vermont: 'VT',
    Virginia: 'VA',
    Washington: 'WA',
    'West Virginia': 'WV',
    Wisconsin: 'WI',
    Wyoming: 'WY',
  };

  return states[stateName] || '';
}

