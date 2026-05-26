export const webImageSources = [
  {
    accession: '2008-06596',
    sourceProvider: 'Lin Hsin Hsin Art Museum',
    sourceType: 'artist_museum_web_image',
    pageUrl: 'https://lhham.com.sg/music/lumiere.html',
    imageUrl: 'https://lhham.com.sg/music/jpg/lumiere.jpg',
    thumbnailUrl: 'https://lhham.com.sg/music/gif/mlumiere.gif',
    sourceTitle: 'son et lumiere',
    sourceArtist: 'Lin Hsin Hsin',
    sourceDate: '1986',
    sourceInstitution: 'National Gallery, Singapore',
    corroboratingUrl:
      'https://www.nationalgallery.sg/content/dam/painting-with-light/2025/archive/updated-28-aug/2021-festival-guide.pdf',
    matchBasis:
      'Title, artist, date, medium, dimensions, and National Gallery Singapore collection statement match the legacy row; NGS festival guide also names the work.',
    note: 'Artist-run web page provides a direct artwork image and states the work is in the National Gallery Singapore collection.',
  },
  {
    accession: '2012-00436',
    sourceProvider: 'Google Arts & Culture',
    sourceType: 'partner_collection_web_image',
    pageUrl:
      'https://artsandculture.google.com/asset/grande-tenue-de-la-cour-d-annam-official-dress-of-the-court-of-annam-nguyen-van-nhan/8AH_JYcRmeF5Zg?hl=en',
    imageUrl:
      'https://lh3.googleusercontent.com/ci/AL18g_R0wlr0zWuWUSRSKw97x6vAZ42TZeyvKFIFJZjTYwQ46vwW7c6qkyhnVTLx0z9giwyZnz3Cx-m_=s1200',
    sourceTitle:
      "Grande tenue de la cour d'Annam (Official Dress of the Court of Annam)",
    sourceArtist: 'Nguyen Van Nhan',
    sourceDate: '1902',
    sourceInstitution: 'National Gallery Singapore',
    rights: 'Copyright expired',
    matchBasis:
      'Google Arts & Culture page identifies the same title, creator, date, dimensions, medium, and National Gallery Singapore partner collection.',
    note: 'Public partner collection page provides both artwork image and rights metadata.',
  },
  {
    accession: '2017-00009',
    sourceProvider: 'Traveler Tina',
    sourceType: 'exhibition_photo_web_image',
    pageUrl:
      'https://travelertina.blog/2018/08/18/collecting-a-collection/',
    imageUrl:
      'https://i0.wp.com/travelertina.blog/wp-content/uploads/2018/08/img_3553.jpg?resize=470%2C844&ssl=1',
    sourceTitle: 'Morning Chores',
    sourceArtist: 'Lee Lim',
    sourceInstitution: 'National Gallery Singapore',
    corroboratingUrl:
      'https://www.nationalgallery.sg/content/dam/about/annual-reports/reports/FY2016%20Annual%20Report.pdf',
    matchBasis:
      'Blog image caption identifies Lee Lim Morning Chores at National Gallery Singapore; NGS FY2016 annual report corroborates title, artist, medium, dimensions, donor, and collection.',
    note: 'Use as web image provenance only; the public blog image is an exhibition photo rather than an official NGS asset.',
  },
  {
    accession: 'GI-0246-(PC)',
    sourceProvider: 'Lin Hsin Hsin Art Museum',
    sourceType: 'artist_museum_web_image',
    pageUrl: 'https://lhham.com.sg/aqua/layers.html',
    imageUrl: 'https://lhham.com.sg/aqua/jpg/layers.jpg',
    thumbnailUrl: 'https://lhham.com.sg/aqua/gif/mlayers.gif',
    sourceTitle: 'layers of time',
    sourceArtist: 'Lin Hsin Hsin',
    sourceDate: '1989',
    sourceInstitution: 'National Art Gallery, Singapore',
    corroboratingUrl:
      'https://www.nationalgallery.sg/sg/en/visit/tours/audio-guide.stop.html/something-new-must-turn-up-audio-tour/23.html?lang=Malay',
    matchBasis:
      'Artist-run web page identifies the same title, date, medium, dimensions, series, and National Art Gallery Singapore collection; NGS audio-guide text names Layers of Time in the Lin Hsin Hsin context.',
    note: 'Artist-run web page provides a direct artwork image and collection statement.',
  },
  {
    accession: 'P-1119',
    sourceProvider: 'ABRY Gallery Store',
    sourceType: 'gallery_store_product_image',
    pageUrl:
      'https://abry.global/collections/jaafar-latiff/products/jaafar-latiff-batik-postcard',
    imageUrl:
      'https://abry.global/cdn/shop/products/JaafarLatiff_Batik14_1749x.png?v=1738820609',
    thumbnailUrl:
      'https://abry.global/cdn/shop/products/JaafarLatiff_Batik14_600x.png?v=1738820609',
    sourceTitle: 'Batik 14 - 87/88',
    sourceArtist: 'Jaafar Latiff',
    corroboratingUrl:
      'https://www.nationalgallery.sg/content/dam/about/annual-reports/reports/FY2021%20Annual%20Report.pdf',
    matchBasis:
      'Gallery Store product image/title matches the work; NGS FY2021 annual report corroborates Jaafar Latiff, Batik 14 - 87/88, accession P-1119.',
    note: 'Use as web image provenance only; source image is product photography for a postcard derived from the collection work.',
  },
];

export const webImageSourcesByAccession = new Map(
  webImageSources.map((source) => [source.accession, source])
);
