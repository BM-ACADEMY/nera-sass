import React, { useState, useEffect } from 'react';
import SopModal from '../../components/common/SopModal.jsx';
import { C } from '../../constants/theme.js';
import { Loader2, Plus, Edit2, Trash2, Code, LayoutDashboard, Sparkles, Network, Globe, AlertCircle, FileJson } from 'lucide-react';
import { api } from '../../services/api.js';

const localBusinessTypes = [
  { value: 'AnimalShelter', label: 'Animal Shelter' },
  { label: 'Automotive', items: [
    { value: 'AutomotiveBusiness', label: 'Automotive Business' },
    { value: 'AutoBodyShop', label: 'Auto Body Shop' },
    { value: 'AutoDealer', label: 'Auto Dealer' },
    { value: 'AutoPartsStore', label: 'Auto Parts Store' },
    { value: 'AutoRental', label: 'Auto Rental' },
    { value: 'AutoRepair', label: 'Auto Repair' },
    { value: 'AutoWash', label: 'Auto Wash' },
    { value: 'GasStation', label: 'Gas Station' },
    { value: 'MotorcycleDealer', label: 'Motorcycle Dealer' },
    { value: 'MotorcycleRepair', label: 'Motorcycle Repair' },
  ]},
  { value: 'ChildCare', label: 'Child Care' },
  { value: 'DryCleaningOrLaundry', label: 'Dry Cleaning Or Laundry' },
  { label: 'Emergency', items: [
    { value: 'EmergencyService', label: 'Emergency Service' },
    { value: 'FireStation', label: 'Fire Station' },
    { value: 'Hospital', label: 'Hospital' },
    { value: 'PoliceStation', label: 'Police Station' }
  ]},
  { value: 'EmploymentAgency', label: 'Employment Agency' },
  { label: 'Entertainment', items: [
    { value: 'EntertainmentBusiness', label: 'Entertainment Business' },
    { value: 'AdultEntertainment', label: 'Adult Entertainment' },
    { value: 'AmusementPark', label: 'Amusement Park' },
    { value: 'ArtGallery', label: 'Art Gallery' },
    { value: 'Casino', label: 'Casino' },
    { value: 'ComedyClub', label: 'Comedy Club' },
    { value: 'MovieTheater', label: 'Movie Theater' },
    { value: 'NightClub', label: 'Night Club' }
  ]},
  { label: 'Financial', items: [
    { value: 'AccountingService', label: 'Accounting Service' },
    { value: 'AutomatedTeller', label: 'Automated Teller' },
    { value: 'BankOrCreditUnion', label: 'Bank Or Credit Union' },
    { value: 'InsuranceAgency', label: 'Insurance Agency' }
  ]},
  { label: 'Food', items: [
    { value: 'FoodEstablishment', label: 'Food Establishment' },
    { value: 'Bakery', label: 'Bakery' },
    { value: 'BarOrPub', label: 'Bar Or Pub' },
    { value: 'Brewery', label: 'Brewery' },
    { value: 'CafeOrCoffeeShop', label: 'Cafe Or Coffee Shop' },
    { value: 'FastFoodRestaurant', label: 'Fast Food Restaurant' },
    { value: 'IceCreamShop', label: 'Ice Cream Shop' },
    { value: 'Restaurant', label: 'Restaurant' },
    { value: 'Winery', label: 'Winery' }
  ]},
  { value: 'GovernmentOffice', label: 'Government Office' },
  { value: 'PostOffice', label: 'Post Office' },
  { label: 'Health And Beauty', items: [
    { value: 'HealthAndBeautyBusiness', label: 'Health And Beauty Business' },
    { value: 'BeautySalon', label: 'Beauty Salon' },
    { value: 'DaySpa', label: 'Day Spa' },
    { value: 'HairSalon', label: 'Hair Salon' },
    { value: 'HealthClub', label: 'Health Club' },
    { value: 'NailSalon', label: 'Nail Salon' },
    { value: 'TattooParlor', label: 'Tattoo Parlor' }
  ]},
  { label: 'Home And Construction', items: [
    { value: 'HomeAndConstructionBusiness', label: 'Home And Construction Business' },
    { value: 'Electrician', label: 'Electrician' },
    { value: 'GeneralContractor', label: 'General Contractor' },
    { value: 'HVACBusiness', label: 'HVAC Business' },
    { value: 'HousePainter', label: 'House Painter' },
    { value: 'Locksmith', label: 'Locksmith' },
    { value: 'MovingCompany', label: 'Moving Company' },
    { value: 'Plumber', label: 'Plumber' },
    { value: 'RoofingContractor', label: 'Roofing Contractor' }
  ]},
  { value: 'InternetCafe', label: 'Internet Cafe' },
  { value: 'Library', label: 'Library' },
  { label: 'Lodging', items: [
    { value: 'LodgingBusiness', label: 'Lodging Business' },
    { value: 'BedAndBreakfast', label: 'Bed And Breakfast' },
    { value: 'Hostel', label: 'Hostel' },
    { value: 'Hotel', label: 'Hotel' },
    { value: 'Motel', label: 'Motel' }
  ]},
  { label: 'Medical/Dental', items: [
    { value: 'Dentist', label: 'Dentist' },
    { value: 'DiagnosticLab', label: 'Diagnostic Lab' },
    { value: 'Hospital', label: 'Hospital' },
    { value: 'MedicalClinic', label: 'Medical Clinic' },
    { value: 'Optician', label: 'Optician' },
    { value: 'Pharmacy', label: 'Pharmacy' },
    { value: 'Physician', label: 'Physician' },
    { value: 'VeterinaryCare', label: 'Veterinary Care' }
  ]},
  { label: 'Professional Services', items: [
    { value: 'ProfessionalService', label: 'Professional Service' },
    { value: 'AccountingService', label: 'Accounting Service' },
    { value: 'Attorney', label: 'Attorney' },
    { value: 'Dentist', label: 'Dentist' },
    { value: 'Electrician', label: 'Electrician' },
    { value: 'GeneralContractor', label: 'General Contractor' },
    { value: 'HousePainter', label: 'House Painter' },
    { value: 'Locksmith', label: 'Locksmith' },
    { value: 'Notary', label: 'Notary' },
    { value: 'Plumber', label: 'Plumber' },
    { value: 'RoofingContractor', label: 'Roofing Contractor' }
  ]},
  { value: 'RadioStation', label: 'Radio Station' },
  { value: 'RealEstateAgent', label: 'Real Estate Agent' },
  { value: 'RecyclingCenter', label: 'Recycling Center' },
  { value: 'SelfStorage', label: 'Self Storage' },
  { value: 'ShoppingCenter', label: 'Shopping Center' },
  { label: 'Sports Activities', items: [
    { value: 'SportsActivityLocation', label: 'Sports Activity Location' },
    { value: 'BowlingAlley', label: 'Bowling Alley' },
    { value: 'ExerciseGym', label: 'Exercise Gym' },
    { value: 'GolfCourse', label: 'Golf Course' },
    { value: 'HealthClub', label: 'Health Club' },
    { value: 'PublicSwimmingPool', label: 'Public Swimming Pool' },
    { value: 'SkiResort', label: 'Ski Resort' },
    { value: 'SportsClub', label: 'Sports Club' },
    { value: 'StadiumOrArena', label: 'Stadium Or Arena' },
    { value: 'TennisComplex', label: 'Tennis Complex' }
  ]},
  { label: 'Stores', items: [
    { value: 'Store', label: 'Store' },
    { value: 'AutoPartsStore', label: 'Auto Parts Store' },
    { value: 'BikeStore', label: 'Bike Store' },
    { value: 'BookStore', label: 'Book Store' },
    { value: 'ClothingStore', label: 'Clothing Store' },
    { value: 'ComputerStore', label: 'Computer Store' },
    { value: 'ConvenienceStore', label: 'Convenience Store' },
    { value: 'DepartmentStore', label: 'Department Store' },
    { value: 'ElectronicsStore', label: 'Electronics Store' },
    { value: 'Florist', label: 'Florist' },
    { value: 'FurnitureStore', label: 'Furniture Store' },
    { value: 'GardenStore', label: 'Garden Store' },
    { value: 'GroceryStore', label: 'Grocery Store' },
    { value: 'HardwareStore', label: 'Hardware Store' },
    { value: 'HobbyShop', label: 'Hobby Shop' },
    { value: 'HomeGoodsStore', label: 'Home Goods Store' },
    { value: 'JewelryStore', label: 'Jewelry Store' },
    { value: 'LiquorStore', label: 'Liquor Store' },
    { value: 'MensClothingStore', label: 'Mens Clothing Store' },
    { value: 'MobilePhoneStore', label: 'Mobile Phone Store' },
    { value: 'MovieRentalStore', label: 'Movie Rental Store' },
    { value: 'MusicStore', label: 'Music Store' },
    { value: 'OfficeEquipmentStore', label: 'Office Equipment Store' },
    { value: 'OutletStore', label: 'Outlet Store' },
    { value: 'PawnShop', label: 'Pawn Shop' },
    { value: 'PetStore', label: 'Pet Store' },
    { value: 'ShoeStore', label: 'Shoe Store' },
    { value: 'SportingGoodsStore', label: 'Sporting Goods Store' },
    { value: 'TireShop', label: 'Tire Shop' },
    { value: 'ToyStore', label: 'Toy Store' },
    { value: 'WholesaleStore', label: 'Wholesale Store' }
  ]},
  { value: 'TelevisionStation', label: 'Television Station' },
  { value: 'TouristInformationCenter', label: 'Tourist Information Center' },
  { value: 'TravelAgency', label: 'Travel Agency' }
];

const timeOptions = [
  "00:00", "00:30", "01:00", "01:30", "02:00", "02:30", "03:00", "03:30",
  "04:00", "04:30", "05:00", "05:30", "06:00", "06:30", "07:00", "07:30",
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
  "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
  "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30",
  "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00", "23:30"
];

const eventTypes = [
  { value: 'Event', label: 'Event' },
  { value: 'BusinessEvent', label: 'Business Event' },
  { value: 'ChildrensEvent', label: 'Childrens Event' },
  { value: 'ComedyEvent', label: 'Comedy Event' },
  { value: 'DanceEvent', label: 'Dance Event' },
  { value: 'EducationEvent', label: 'Educational Event' },
  { value: 'Festival', label: 'Festival' },
  { value: 'FoodEvent', label: 'Food Event' },
  { value: 'LiteraryEvent', label: 'Literary Event' },
  { value: 'MusicEvent', label: 'Music Event' },
  { value: 'SaleEvent', label: 'Sales Event' },
  { value: 'SocialEvent', label: 'Social Event' },
  { value: 'SportsEvent', label: 'Sports Event' },
  { value: 'TheaterEvent', label: 'Theater Event' },
  { value: 'UserInteraction', label: 'User Interaction' },
  { value: 'VisualArtsEvent', label: 'Visual Arts Event' }
];

const organizationTypes = [
  { value: 'Organization', label: 'Organization' },
  { value: 'Corporation', label: 'Corporation' },
  { value: 'EducationalOrganization', label: 'Educational Organization' },
  { value: 'GovernmentOrganization', label: 'Government Organization' },
  { value: 'LocalBusiness', label: 'Local Business' },
  { value: 'NGO', label: 'Non-Governmental Organization (NGO)' },
  { value: 'PerformingGroup', label: 'Performing Group' },
  { value: 'SportsTeam', label: 'Sports Team' }
];

const generateJsonLd = (type, fields, extraLinks, businessHours) => {
  if (!type) return null;
  
  const obj = {
    "@context": "https://schema.org"
  };
  
  if (type === 'business') {
    obj["@type"] = fields.businessType || 'LocalBusiness';
    if (fields.name) obj["name"] = fields.name;
    if (fields.url) obj["url"] = fields.url;
    
    const validLinks = extraLinks.filter(l => l.trim() !== '');
    if (validLinks.length > 0) {
      obj["sameAs"] = validLinks;
    }
    
    if (fields.logo) obj["logo"] = fields.logo;
    if (fields.image) obj["image"] = fields.image;
    if (fields.description) obj["description"] = fields.description;
    
    if (fields.streetAddress || fields.city || fields.state || fields.postalCode || fields.country) {
      obj["address"] = {
        "@type": "PostalAddress"
      };
      if (fields.streetAddress) obj["address"]["streetAddress"] = fields.streetAddress;
      if (fields.city) obj["address"]["addressLocality"] = fields.city;
      if (fields.state) obj["address"]["addressRegion"] = fields.state;
      if (fields.postalCode) obj["address"]["postalCode"] = fields.postalCode;
      if (fields.country) obj["address"]["addressCountry"] = fields.country;
    }
    
    if (fields.latitude || fields.longitude) {
      obj["geo"] = {
        "@type": "GeoCoordinates"
      };
      if (fields.latitude) obj["geo"]["latitude"] = fields.latitude;
      if (fields.longitude) obj["geo"]["longitude"] = fields.longitude;
    }
    
    if (fields.hasMap) obj["hasMap"] = fields.hasMap;
    
    const hours = [];
    Object.keys(businessHours).forEach(day => {
      const bh = businessHours[day];
      if (bh.checked && bh.open && bh.close) {
        hours.push(`${day} ${bh.open}-${bh.close}`);
      }
    });
    if (hours.length > 0) {
      obj["openingHours"] = hours;
    }
    
    if (fields.phone || fields.contactType) {
      obj["contactPoint"] = {
        "@type": "ContactPoint"
      };
      if (fields.phone) obj["contactPoint"]["telephone"] = fields.phone;
      if (fields.contactType) obj["contactPoint"]["contactType"] = fields.contactType;
    }
  }
  
  else if (type === 'person') {
    obj["@type"] = "Person";
    if (fields.name) obj["name"] = fields.name;
    if (fields.jobTitle) obj["jobTitle"] = fields.jobTitle;
    if (fields.url) obj["url"] = fields.url;
    
    if (fields.streetAddress || fields.city || fields.state || fields.postalCode || fields.country || fields.poBox) {
      obj["address"] = {
        "@type": "PostalAddress"
      };
      if (fields.streetAddress) obj["address"]["streetAddress"] = fields.streetAddress;
      if (fields.poBox) obj["address"]["postOfficeBoxNumber"] = fields.poBox;
      if (fields.city) obj["address"]["addressLocality"] = fields.city;
      if (fields.state) obj["address"]["addressRegion"] = fields.state;
      if (fields.postalCode) obj["address"]["postalCode"] = fields.postalCode;
      if (fields.country) obj["address"]["addressCountry"] = fields.country;
    }
    
    if (fields.email) obj["email"] = fields.email;
    if (fields.phone) obj["telephone"] = fields.phone;
    if (fields.birthDate) obj["birthDate"] = fields.birthDate;
  }
  
  else if (type === 'product') {
    obj["@type"] = "Product";
    if (fields.brand) obj["brand"] = fields.brand;
    if (fields.name) obj["name"] = fields.name;
    if (fields.image) obj["image"] = fields.image;
    if (fields.description) obj["description"] = fields.description;
    
    if (fields.rating || fields.reviews) {
      obj["aggregateRating"] = {
        "@type": "AggregateRating"
      };
      if (fields.rating) obj["aggregateRating"]["ratingValue"] = fields.rating;
      if (fields.reviews) obj["aggregateRating"]["reviewCount"] = fields.reviews;
    }
  }
  
  else if (type === 'event') {
    obj["@type"] = fields.eventType || 'Event';
    if (fields.name) obj["name"] = fields.name;
    if (fields.url) obj["url"] = fields.url;
    if (fields.description) obj["description"] = fields.description;
    if (fields.startDate) obj["startDate"] = fields.startDate;
    if (fields.endDate) obj["endDate"] = fields.endDate;
    
    if (fields.locationName || fields.locationURL || fields.streetAddress || fields.city || fields.state || fields.postalCode || fields.country) {
      obj["location"] = {
        "@type": "Place"
      };
      if (fields.locationName) obj["location"]["name"] = fields.locationName;
      if (fields.locationURL) obj["location"]["sameAs"] = fields.locationURL;
      
      if (fields.streetAddress || fields.city || fields.state || fields.postalCode || fields.country) {
        obj["location"]["address"] = {
          "@type": "PostalAddress"
        };
        if (fields.streetAddress) obj["location"]["address"]["streetAddress"] = fields.streetAddress;
        if (fields.city) obj["location"]["address"]["addressLocality"] = fields.city;
        if (fields.state) obj["location"]["address"]["addressRegion"] = fields.state;
        if (fields.postalCode) obj["location"]["address"]["postalCode"] = fields.postalCode;
        if (fields.country) obj["location"]["address"]["addressCountry"] = fields.country;
      }
    }
    
    if (fields.offerDesc || fields.offerURL || fields.offerPrice) {
      obj["offers"] = {
        "@type": "Offer"
      };
      if (fields.offerDesc) obj["offers"]["description"] = fields.offerDesc;
      if (fields.offerURL) obj["offers"]["url"] = fields.offerURL;
      if (fields.offerPrice) obj["offers"]["price"] = fields.offerPrice;
    }
  }
  
  else if (type === 'organization') {
    obj["@type"] = fields.orgType || 'Organization';
    if (fields.name) obj["name"] = fields.name;
    if (fields.url) obj["url"] = fields.url;
    
    const validLinks = extraLinks.filter(l => l.trim() !== '');
    if (validLinks.length > 0) {
      obj["sameAs"] = validLinks;
    }
    
    if (fields.logo) obj["logo"] = fields.logo;
    if (fields.image) obj["image"] = fields.image;
    if (fields.description) obj["description"] = fields.description;
    
    if (fields.streetAddress || fields.city || fields.state || fields.postalCode || fields.country || fields.poBox) {
      obj["address"] = {
        "@type": "PostalAddress"
      };
      if (fields.streetAddress) obj["address"]["streetAddress"] = fields.streetAddress;
      if (fields.poBox) obj["address"]["postOfficeBoxNumber"] = fields.poBox;
      if (fields.city) obj["address"]["addressLocality"] = fields.city;
      if (fields.state) obj["address"]["addressRegion"] = fields.state;
      if (fields.postalCode) obj["address"]["postalCode"] = fields.postalCode;
      if (fields.country) obj["address"]["addressCountry"] = fields.country;
    }
    
    if (fields.latitude || fields.longitude) {
      obj["geo"] = {
        "@type": "GeoCoordinates"
      };
      if (fields.latitude) obj["geo"]["latitude"] = fields.latitude;
      if (fields.longitude) obj["geo"]["longitude"] = fields.longitude;
    }
    
    if (fields.hasMap) obj["hasMap"] = fields.hasMap;
    
    const hours = [];
    Object.keys(businessHours).forEach(day => {
      const bh = businessHours[day];
      if (bh.checked && bh.open && bh.close) {
        hours.push(`${day} ${bh.open}-${bh.close}`);
      }
    });
    if (hours.length > 0) {
      obj["openingHours"] = hours;
    }
    
    if (fields.phone || fields.contactType) {
      obj["contactPoint"] = {
        "@type": "ContactPoint"
      };
      if (fields.phone) obj["contactPoint"]["telephone"] = fields.phone;
      if (fields.contactType) obj["contactPoint"]["contactType"] = fields.contactType;
    }
  }
  
  else if (type === 'website') {
    obj["@type"] = "WebSite";
    if (fields.name) obj["name"] = fields.name;
    if (fields.alternateName) obj["alternateName"] = fields.alternateName;
    if (fields.url) obj["url"] = fields.url;
  }
  
  return obj;
};

export default function SchemaLibrary() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  
  // Generator State
  const [genForm, setGenForm] = useState({ businessName: '', businessType: 'LocalBusiness', website: '', description: '' });
  const [generating, setGenerating] = useState(false);
  const [generatedSchema, setGeneratedSchema] = useState(null);
  
  // Interactive Builder State
  const [builderMode, setBuilderMode] = useState('interactive'); // 'interactive' or 'ai'
  const [builderType, setBuilderType] = useState(''); // '', 'business', 'person', 'product', 'event', 'organization', 'website'
  const [builderFields, setBuilderFields] = useState({
    businessType: 'AnimalShelter',
    name: '',
    url: '',
    logo: '',
    image: '',
    description: '',
    streetAddress: '',
    poBox: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
    latitude: '',
    longitude: '',
    hasMap: '',
    phone: '',
    contactType: '',
    jobTitle: '',
    email: '',
    birthDate: '',
    brand: '',
    rating: '',
    reviews: '',
    eventType: 'Event',
    startDate: '',
    endDate: '',
    locationName: '',
    locationURL: '',
    offerDesc: '',
    offerURL: '',
    offerPrice: '',
    orgType: 'Organization',
    alternateName: ''
  });
  const [extraLinks, setExtraLinks] = useState(['']);
  const [businessHours, setBusinessHours] = useState({
    Mo: { checked: false, open: '09:00', close: '17:00' },
    Tu: { checked: false, open: '09:00', close: '17:00' },
    We: { checked: false, open: '09:00', close: '17:00' },
    Th: { checked: false, open: '09:00', close: '17:00' },
    Fr: { checked: false, open: '09:00', close: '17:00' },
    Sa: { checked: false, open: '09:00', close: '17:00' },
    Su: { checked: false, open: '09:00', close: '17:00' }
  });
  
  // Validation State
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  // Entity State
  const [entityLinks, setEntityLinks] = useState([
    { type: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Example_Company' },
    { type: 'LinkedIn', url: 'https://linkedin.com/company/example' }
  ]);
  const [newLink, setNewLink] = useState({ type: 'Twitter', url: '' });
  const [updateGraphModalOpen, setUpdateGraphModalOpen] = useState(false);
  const [updatingGraph, setUpdatingGraph] = useState(false);
  const [showAllEntities, setShowAllEntities] = useState(false);

  // Deployment State
  const [deployForm, setDeployForm] = useState({ templateId: '', clientUrl: '' });
  const [deploying, setDeploying] = useState(false);
  const [deploymentScript, setDeploymentScript] = useState('');
  const [activeDeployments, setActiveDeployments] = useState([]);
  const [copied, setCopied] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    schema_type: 'LocalBusiness',
    description: '',
    schema_data: '{\n  "@context": "https://schema.org",\n  "@type": "LocalBusiness",\n  "name": ""\n}'
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [resTemplates, resEntities, resDeployments] = await Promise.all([
        api.get('/thedal/schemalibrary'),
        api.get('/thedal/schemalibrary/entities'),
        api.get('/thedal/schemalibrary/deployments')
      ]);
      
      if (resTemplates.items) setData(resTemplates.items);
      if (resEntities.entities && resEntities.entities.length > 0) {
        setEntityLinks(resEntities.entities);
      }
      if (resDeployments.deployments) {
        // Map backend shape to frontend expected shape
        setActiveDeployments(resDeployments.deployments.map(d => ({
          clientUrl: d.client_url,
          templateName: d.template_name,
          deployedAt: d.deployed_at
        })));
      }
    } catch (err) {
      console.error('Failed to load schema data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddLink = (e) => {
    e.preventDefault();
    setExtraLinks([...extraLinks, '']);
  };

  const handleRemoveLink = (e) => {
    e.preventDefault();
    if (extraLinks.length > 1) {
      setExtraLinks(extraLinks.slice(0, -1));
    } else {
      setExtraLinks(['']);
    }
  };

  const handleLinkChange = (idx, value) => {
    const arr = [...extraLinks];
    arr[idx] = value;
    setExtraLinks(arr);
  };

  const handleHourToggle = (day) => {
    setBusinessHours(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        checked: !prev[day].checked
      }
    }));
  };

  const handleHourChange = (day, type, value) => {
    setBusinessHours(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [type]: value
      }
    }));
  };

  const handleResetBuilder = (e) => {
    e.preventDefault();
    setBuilderFields({
      businessType: 'AnimalShelter',
      name: '',
      url: '',
      logo: '',
      image: '',
      description: '',
      streetAddress: '',
      poBox: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
      latitude: '',
      longitude: '',
      hasMap: '',
      phone: '',
      contactType: '',
      jobTitle: '',
      email: '',
      birthDate: '',
      brand: '',
      rating: '',
      reviews: '',
      eventType: 'Event',
      startDate: '',
      endDate: '',
      locationName: '',
      locationURL: '',
      offerDesc: '',
      offerURL: '',
      offerPrice: '',
      orgType: 'Organization',
      alternateName: ''
    });
    setExtraLinks(['']);
    setBusinessHours({
      Mo: { checked: false, open: '09:00', close: '17:00' },
      Tu: { checked: false, open: '09:00', close: '17:00' },
      We: { checked: false, open: '09:00', close: '17:00' },
      Th: { checked: false, open: '09:00', close: '17:00' },
      Fr: { checked: false, open: '09:00', close: '17:00' },
      Sa: { checked: false, open: '09:00', close: '17:00' },
      Su: { checked: false, open: '09:00', close: '17:00' }
    });
  };

  const handleFillDemo = (e) => {
    e.preventDefault();
    if (!builderType) {
      alert("Please select a schema type first.");
      return;
    }

    if (builderType === 'business') {
      setBuilderFields({
        businessType: 'Restaurant',
        name: 'The Golden Spoon Bistro',
        url: 'https://www.goldenspoonbistro.com',
        logo: 'https://www.goldenspoonbistro.com/assets/logo.png',
        image: 'https://www.goldenspoonbistro.com/assets/interior.jpg',
        description: 'Award-winning French-Italian fusion dining experience in the heart of downtown.',
        streetAddress: '456 Culinary Boulevard',
        poBox: '',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
        country: 'US',
        latitude: '40.7128',
        longitude: '-74.0060',
        hasMap: 'https://maps.google.com/?cid=123456789',
        phone: '+1 (555) 019-2834',
        contactType: 'customer service',
        jobTitle: '',
        email: '',
        birthDate: '',
        brand: '',
        rating: '',
        reviews: '',
        eventType: 'Event',
        startDate: '',
        endDate: '',
        locationName: '',
        locationURL: '',
        offerDesc: '',
        offerURL: '',
        offerPrice: '',
        orgType: 'Organization',
        alternateName: ''
      });
      setExtraLinks(['https://facebook.com/goldenspoon', 'https://instagram.com/goldenspoon']);
      setBusinessHours({
        Mo: { checked: true, open: '09:00', close: '22:00' },
        Tu: { checked: true, open: '09:00', close: '22:00' },
        We: { checked: true, open: '09:00', close: '22:00' },
        Th: { checked: true, open: '09:00', close: '22:00' },
        Fr: { checked: true, open: '09:00', close: '23:00' },
        Sa: { checked: true, open: '10:00', close: '23:00' },
        Su: { checked: false, open: '09:00', close: '17:00' }
      });
    } else if (builderType === 'person') {
      setBuilderFields({
        businessType: 'AnimalShelter',
        name: 'Alice Henderson',
        url: 'https://alicehenderson.com',
        logo: '',
        image: '',
        description: '',
        streetAddress: '789 Digital Way',
        poBox: 'PO Box 99',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94103',
        country: 'US',
        latitude: '',
        longitude: '',
        hasMap: '',
        phone: '+1 (555) 014-9988',
        contactType: '',
        jobTitle: 'Lead SEO Specialist',
        email: 'alice@domain.com',
        birthDate: '1988-04-12',
        brand: '',
        rating: '',
        reviews: '',
        eventType: 'Event',
        startDate: '',
        endDate: '',
        locationName: '',
        locationURL: '',
        offerDesc: '',
        offerURL: '',
        offerPrice: '',
        orgType: 'Organization',
        alternateName: ''
      });
      setExtraLinks(['']);
      setBusinessHours({
        Mo: { checked: false, open: '09:00', close: '17:00' },
        Tu: { checked: false, open: '09:00', close: '17:00' },
        We: { checked: false, open: '09:00', close: '17:00' },
        Th: { checked: false, open: '09:00', close: '17:00' },
        Fr: { checked: false, open: '09:00', close: '17:00' },
        Sa: { checked: false, open: '09:00', close: '17:00' },
        Su: { checked: false, open: '09:00', close: '17:00' }
      });
    } else if (builderType === 'product') {
      setBuilderFields({
        businessType: 'AnimalShelter',
        name: 'Premium SEO Analytics Pro',
        url: '',
        logo: '',
        image: 'https://saasify.io/assets/seo-dashboard.png',
        description: 'All-in-one SEO tracking, competitor gap analytics, and automated schema generation software.',
        streetAddress: '',
        poBox: '',
        city: '',
        state: '',
        postalCode: '',
        country: '',
        latitude: '',
        longitude: '',
        hasMap: '',
        phone: '',
        contactType: '',
        jobTitle: '',
        email: '',
        birthDate: '',
        brand: 'SaaSify',
        rating: '4.9',
        reviews: '142',
        eventType: 'Event',
        startDate: '',
        endDate: '',
        locationName: '',
        locationURL: '',
        offerDesc: '',
        offerURL: '',
        offerPrice: '',
        orgType: 'Organization',
        alternateName: ''
      });
      setExtraLinks(['']);
      setBusinessHours({
        Mo: { checked: false, open: '09:00', close: '17:00' },
        Tu: { checked: false, open: '09:00', close: '17:00' },
        We: { checked: false, open: '09:00', close: '17:00' },
        Th: { checked: false, open: '09:00', close: '17:00' },
        Fr: { checked: false, open: '09:00', close: '17:00' },
        Sa: { checked: false, open: '09:00', close: '17:00' },
        Su: { checked: false, open: '09:00', close: '17:00' }
      });
    } else if (builderType === 'event') {
      setBuilderFields({
        businessType: 'AnimalShelter',
        name: 'Global SEO Innovation Summit 2026',
        url: 'https://seosummit.org',
        logo: '',
        image: '',
        description: 'Learn advanced search engine marketing, semantic structure mapping, and AI optimization strategies from industry pioneers.',
        streetAddress: '100 Innovation Plaza',
        poBox: '',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        country: 'US',
        latitude: '',
        longitude: '',
        hasMap: '',
        phone: '',
        contactType: '',
        jobTitle: '',
        email: '',
        birthDate: '',
        brand: '',
        rating: '',
        reviews: '',
        eventType: 'BusinessEvent',
        startDate: '2026-10-15T09:00',
        endDate: '2026-10-17T17:00',
        locationName: 'Tech Convention Hall',
        locationURL: 'https://techconvention.com',
        offerDesc: 'Early Bird Pass',
        offerURL: 'https://seosummit.org/tickets',
        offerPrice: '299.00',
        orgType: 'Organization',
        alternateName: ''
      });
      setExtraLinks(['']);
      setBusinessHours({
        Mo: { checked: false, open: '09:00', close: '17:00' },
        Tu: { checked: false, open: '09:00', close: '17:00' },
        We: { checked: false, open: '09:00', close: '17:00' },
        Th: { checked: false, open: '09:00', close: '17:00' },
        Fr: { checked: false, open: '09:00', close: '17:00' },
        Sa: { checked: false, open: '09:00', close: '17:00' },
        Su: { checked: false, open: '09:00', close: '17:00' }
      });
    } else if (builderType === 'organization') {
      setBuilderFields({
        businessType: 'AnimalShelter',
        name: 'Apex Global Technologies',
        url: 'https://www.apexglobal.tech',
        logo: 'https://www.apexglobal.tech/assets/brand-logo.png',
        image: 'https://www.apexglobal.tech/assets/office-hq.png',
        description: 'Pioneering cloud solutions, data pipeline engineering, and machine learning infrastructure.',
        streetAddress: '500 Silicon Towers, Floor 12',
        poBox: '',
        city: 'Seattle',
        state: 'WA',
        postalCode: '98101',
        country: 'US',
        latitude: '47.6062',
        longitude: '-122.3321',
        hasMap: 'https://maps.google.com/?cid=987654321',
        phone: '+1 (206) 555-0100',
        contactType: 'customer service',
        jobTitle: '',
        email: '',
        birthDate: '',
        brand: '',
        rating: '',
        reviews: '',
        eventType: 'Event',
        startDate: '',
        endDate: '',
        locationName: '',
        locationURL: '',
        offerDesc: '',
        offerURL: '',
        offerPrice: '',
        orgType: 'Corporation',
        alternateName: ''
      });
      setExtraLinks(['https://linkedin.com/company/apex-global', 'https://twitter.com/apexglobaltech']);
      setBusinessHours({
        Mo: { checked: true, open: '09:00', close: '17:00' },
        Tu: { checked: true, open: '09:00', close: '17:00' },
        We: { checked: true, open: '09:00', close: '17:00' },
        Th: { checked: true, open: '09:00', close: '17:00' },
        Fr: { checked: true, open: '09:00', close: '17:00' },
        Sa: { checked: false, open: '09:00', close: '17:00' },
        Su: { checked: false, open: '09:00', close: '17:00' }
      });
    } else if (builderType === 'website') {
      setBuilderFields({
        businessType: 'AnimalShelter',
        name: 'The SEO Insider',
        url: 'https://seoinsider.blog',
        logo: '',
        image: '',
        description: '',
        streetAddress: '',
        poBox: '',
        city: '',
        state: '',
        postalCode: '',
        country: '',
        latitude: '',
        longitude: '',
        hasMap: '',
        phone: '',
        contactType: '',
        jobTitle: '',
        email: '',
        birthDate: '',
        brand: '',
        rating: '',
        reviews: '',
        eventType: 'Event',
        startDate: '',
        endDate: '',
        locationName: '',
        locationURL: '',
        offerDesc: '',
        offerURL: '',
        offerPrice: '',
        orgType: 'Organization',
        alternateName: 'SEO Insider'
      });
      setExtraLinks(['']);
      setBusinessHours({
        Mo: { checked: false, open: '09:00', close: '17:00' },
        Tu: { checked: false, open: '09:00', close: '17:00' },
        We: { checked: false, open: '09:00', close: '17:00' },
        Th: { checked: false, open: '09:00', close: '17:00' },
        Fr: { checked: false, open: '09:00', close: '17:00' },
        Sa: { checked: false, open: '09:00', close: '17:00' },
        Su: { checked: false, open: '09:00', close: '17:00' }
      });
    }
  };

  const handleSaveBuilder = (e) => {
    e.preventDefault();
    const schemaObj = generateJsonLd(builderType, builderFields, extraLinks, businessHours);
    if (!schemaObj) {
      alert("Please select a schema type and fill some fields first.");
      return;
    }
    
    setEditingId(null);
    setFormData({
      name: `Builder ${schemaObj['@type']} for ${schemaObj['name'] || 'Unnamed'}`,
      schema_type: schemaObj['@type'] || 'LocalBusiness',
      description: 'Created using Schema Builder',
      schema_data: JSON.stringify(schemaObj, null, 2)
    });
    setValidationResult(null);
    setModalOpen(true);
  };

  const [copiedBuilderCode, setCopiedBuilderCode] = useState(false);
  const handleCopyBuilderCode = (code) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(code).then(() => {
        setCopiedBuilderCode(true);
        setTimeout(() => setCopiedBuilderCode(false), 2000);
      }).catch(() => {
        fallbackCopyTextToClipboard(code);
      });
    } else {
      fallbackCopyTextToClipboard(code);
    }
  };

  const handleOpenModal = (item = null) => {
    if (item) {
      setEditingId(item.id);
      setFormData({
        name: item.name,
        schema_type: item.schema_type,
        description: item.description || '',
        schema_data: JSON.stringify(item.schema_data, null, 2)
      });
    } else {
      setEditingId(null);
      setFormData({
        name: '',
        schema_type: 'LocalBusiness',
        description: '',
        schema_data: '{\n  "@context": "https://schema.org",\n  "@type": "LocalBusiness",\n  "name": ""\n}'
      });
    }
    setValidationResult(null);
    setModalOpen(true);
  };

  const handleGenerate = async () => {
    if (!genForm.businessName || !genForm.businessType) {
      alert("Business Name and Type are required.");
      return;
    }
    setGenerating(true);
    try {
      const res = await api.post('/thedal/schemalibrary/generate', genForm);
      setGeneratedSchema(res.schema_data);
    } catch (err) {
      alert('Failed to generate schema: ' + (err.response?.data?.error || err.message));
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveGenerated = () => {
    setEditingId(null);
    setFormData({
      name: `Auto-Generated ${genForm.businessType} for ${genForm.businessName}`,
      schema_type: genForm.businessType,
      description: 'Generated by Gemini AI',
      schema_data: JSON.stringify(generatedSchema, null, 2)
    });
    setValidationResult(null);
    setModalOpen(true);
    setActiveTab('templates');
  };

  const handleValidate = async () => {
    let parsedJson;
    try {
      parsedJson = JSON.parse(formData.schema_data);
    } catch(e) {
      alert("Invalid JSON format. Cannot validate.");
      return;
    }
    
    setValidating(true);
    setValidationResult(null);
    try {
      const res = await api.post('/thedal/schemalibrary/validate', { schema_data: parsedJson });
      setValidationResult(res);
    } catch (err) {
      alert('Failed to validate schema: ' + (err.response?.data?.error || err.message));
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.schema_data) {
      alert("Name and Schema JSON are required.");
      return;
    }
    
    let parsedJson;
    try {
      parsedJson = JSON.parse(formData.schema_data);
    } catch(e) {
      alert("Invalid JSON format in Schema Data.");
      return;
    }

    const payload = {
      ...formData,
      schema_data: parsedJson
    };

    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/thedal/schemalibrary/${editingId}`, payload);
      } else {
        await api.post('/thedal/schemalibrary', payload);
      }
      setModalOpen(false);
      fetchData();
    } catch (err) {
      alert('Failed to save template: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const generateDeployment = () => {
    if (!deployForm.templateId || !deployForm.clientUrl) {
      alert("Please select a template and enter a client URL.");
      return;
    }

    const template = data.find(t => t.id.toString() === deployForm.templateId);
    if (!template) return;

    let schemaObj = typeof template.schema_data === 'string' ? JSON.parse(template.schema_data) : template.schema_data;
    
    // Inject Entity Links (sameAs)
    if (entityLinks.length > 0) {
      const urls = entityLinks.map(l => l.url);
      
      const injectIntoNode = (node) => {
        if (node['@type'] === 'Organization' || node['@type'] === 'LocalBusiness' || (typeof node['@type'] === 'string' && node['@type'].includes('Business'))) {
          node.sameAs = urls;
        }
        return node;
      };

      if (Array.isArray(schemaObj)) {
        schemaObj = schemaObj.map(injectIntoNode);
      } else if (schemaObj['@graph'] && Array.isArray(schemaObj['@graph'])) {
        schemaObj['@graph'] = schemaObj['@graph'].map(injectIntoNode);
      } else {
        injectIntoNode(schemaObj);
      }
    }

    const scriptCode = `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`;
    setDeploymentScript(scriptCode);
  };

  const handlePushDeploy = async () => {
    if(!deploymentScript) return;
    setDeploying(true);
    try {
      await api.post('/thedal/schemalibrary/deployments', {
        templateId: deployForm.templateId,
        clientUrl: deployForm.clientUrl
      });
      const template = data.find(t => t.id.toString() === deployForm.templateId);
      setActiveDeployments([...activeDeployments, { clientUrl: deployForm.clientUrl, templateName: template?.name }]);
      alert("Success! Schema pushed via API to " + deployForm.clientUrl);
    } catch (err) {
      alert("Failed to push deployment: " + (err.response?.data?.error || err.message));
    } finally {
      setDeploying(false);
    }
  };

  const handleCopyCode = () => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(deploymentScript).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        fallbackCopyTextToClipboard(deploymentScript);
      });
    } else {
      fallbackCopyTextToClipboard(deploymentScript);
    }
  };

  const fallbackCopyTextToClipboard = (text) => {
    var textArea = document.createElement("textarea");
    textArea.value = text;
    // Avoid scrolling to bottom
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      alert("Failed to copy code");
    }
    document.body.removeChild(textArea);
  };

  const triggerDelete = (item) => {
    setTemplateToDelete(item);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!templateToDelete) return;
    try {
      await api.delete(`/thedal/schemalibrary/${templateToDelete.id}`);
      setDeleteModalOpen(false);
      setTemplateToDelete(null);
      fetchData();
    } catch (err) {
      alert('Failed to delete template: ' + err.message);
    }
  };

  const renderDashboard = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
        <div style={{ color: C.muted, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Total Templates</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: '#e2e8f0' }}>{data.length}</div>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
        <div style={{ color: C.muted, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Active Deployments</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: '#e2e8f0' }}>{activeDeployments.length}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Live via API</div>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
        <div style={{ color: C.muted, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Validation Errors</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: '#22c55e' }}>0</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>All templates valid</div>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
        <div style={{ color: C.muted, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Connected Websites</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: '#e2e8f0' }}>{new Set(activeDeployments.map(d=>d.clientUrl)).size}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Unique domains</div>
      </div>

      {/* Recent Deployments Table */}
      <div style={{ gridColumn: '1 / -1', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginTop: 10 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Globe size={18} color={C.accent} /> Recent API Deployments
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Client URL</th>
              <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Template Applied</th>
              <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Deployed At</th>
              <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {activeDeployments.length > 0 ? activeDeployments.map((dep, idx) => (
              <tr key={idx} style={{ borderBottom: `1px solid ${C.border}55` }}>
                <td style={{ padding: '16px 10px', fontSize: 14, color: '#38bdf8', fontWeight: 600 }}>{dep.clientUrl}</td>
                <td style={{ padding: '16px 10px', fontSize: 14, color: '#e2e8f0' }}>{dep.templateName || 'Unknown Template'}</td>
                <td style={{ padding: '16px 10px', fontSize: 13, color: '#94a3b8' }}>
                  {dep.deployedAt ? new Date(dep.deployedAt).toLocaleString() : 'Just now'}
                </td>
                <td style={{ padding: '16px 10px', textAlign: 'right' }}>
                  <span style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                    Live
                  </span>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={4} style={{ padding: '40px 0', textAlign: 'center', color: C.muted }}>No active deployments yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderTemplates = () => (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Schema Templates</h3>
        <button 
          onClick={() => handleOpenModal()}
          style={{ background: C.accent, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Plus size={16} /> New Template
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Name</th>
            <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Type</th>
            <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Description</th>
            <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.length > 0 ? data.map((item) => (
            <tr key={item.id} style={{ borderBottom: `1px solid ${C.border}55` }}>
              <td style={{ padding: '16px 10px', fontSize: 14, color: '#e2e8f0', fontWeight: 600 }}>{item.name}</td>
              <td style={{ padding: '16px 10px' }}>
                <span style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                  {item.schema_type}
                </span>
              </td>
              <td style={{ padding: '16px 10px', fontSize: 13, color: '#94a3b8' }}>{item.description || '-'}</td>
              <td style={{ padding: '16px 10px', textAlign: 'right' }}>
                <button onClick={() => handleOpenModal(item)} style={{ background: 'transparent', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 4, marginRight: 8 }}>
                  <Edit2 size={16} />
                </button>
                <button onClick={() => triggerDelete(item)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}>
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          )) : (
            <tr><td colSpan={4} style={{ padding: '40px 0', textAlign: 'center', color: C.muted }}>No templates found. Create one to get started.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderGenerator = () => {
    const inputStyle = {
      width: '100%',
      background: 'rgba(255, 255, 255, 0.03)',
      border: `1px solid ${C.border}`,
      color: '#fff',
      padding: '12px 16px',
      borderRadius: 8,
      outline: 'none',
      fontSize: '14px',
      transition: 'border-color 0.2s',
      marginTop: '4px'
    };

    const labelStyle = {
      display: 'block',
      fontSize: '12px',
      fontWeight: 600,
      color: C.muted,
      textTransform: 'uppercase',
      marginTop: '12px'
    };

    const sopGuides = {
      business: {
        title: "SOP: Local Business Schema",
        desc: "Use this markup for brick-and-mortar stores, local service branches, or physical offices.",
        points: [
          "Goal: Boosts local search visibility and maps presence.",
          "Required: Business Name, URL, physical Address, and Phone Number.",
          "Best Practice: Add high-precision Latitude/Longitude coordinates and business hours."
        ]
      },
      person: {
        title: "SOP: Person Schema",
        desc: "Use this for authors, founders, executives, or public figures.",
        points: [
          "Goal: Establishes author authority (E-E-A-T) and builds personal Knowledge Panels.",
          "Required: Person's Name and primary Website/Profile URL.",
          "Best Practice: Disambiguate with detailed job title and social links."
        ]
      },
      product: {
        title: "SOP: Product Schema",
        desc: "Use this exclusively on individual product pages. Do not apply to category list pages.",
        points: [
          "Goal: Enables rich snippet stars, review counts, pricing, and availability in search results.",
          "Required: Brand name, Product name, Image URL, and Description.",
          "Best Practice: Always populate Rating and Review count to activate rich results."
        ]
      },
      event: {
        title: "SOP: Event Schema",
        desc: "Use this for webinars, conferences, concert tours, festivals, or local scheduled events.",
        points: [
          "Goal: Showcases your event details directly in Google's rich interactive Event search.",
          "Required: Event Name, Start Date, Venue details (Name & Address), and Ticket pricing/URL.",
          "Best Practice: Ensure dates are in ISO format and specify the correct timezone."
        ]
      },
      organization: {
        title: "SOP: Organization Schema",
        desc: "Use this on homepages or corporate pages for brand identity.",
        points: [
          "Goal: Connects your brand, official Logo, and social profile links in search Knowledge Panels.",
          "Required: Organization Name, Website URL, and official Logo URL.",
          "Best Practice: Use 'sameAs' profile links (e.g. Wikipedia, Wikidata) to establish company identity."
        ]
      },
      website: {
        title: "SOP: Website Schema",
        desc: "Use this exclusively on the homepage of your website.",
        points: [
          "Goal: Declares your official Site Name and alternate names in search listings.",
          "Required: Site Name and URL.",
          "Best Practice: Ensure site name matches the actual brand title used in search layouts."
        ]
      }
    };

    const compiledJson = builderType ? generateJsonLd(builderType, builderFields, extraLinks, businessHours) : null;
    const compiledCodeString = compiledJson ? `<script type="application/ld+json">\n${JSON.stringify(compiledJson, null, 2)}\n</script>` : '';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: 'calc(100vh - 200px)' }}>
        {/* Toggle Switcher */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 24px' }}>
          <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.03)', padding: 4, borderRadius: 8, border: `1px solid ${C.border}` }}>
            <button
              onClick={() => setBuilderMode('interactive')}
              style={{
                background: builderMode === 'interactive' ? C.accent : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '8px 20px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Interactive Builder
            </button>
            <button
              onClick={() => setBuilderMode('ai')}
              style={{
                background: builderMode === 'ai' ? C.accent : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '8px 20px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              AI Generator
            </button>
          </div>
          <div style={{ fontSize: 13, color: C.muted }}>
            {builderMode === 'interactive' ? 'Build standard schemas manually' : 'Generate complete schemas with Gemini AI'}
          </div>
        </div>

        {builderMode === 'ai' ? (
          <div style={{ display: 'flex', gap: 30, flex: 1, minHeight: 0 }}>
            {/* Existing AI Generator Form */}
            <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 30, overflowY: 'auto' }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} color={C.accent} /> Business Context
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase' }}>Business Name *</label>
                  <input 
                    type="text" value={genForm.businessName} onChange={e => setGenForm({...genForm, businessName: e.target.value})}
                    placeholder="e.g. Acme Plumbing"
                    style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: '#fff', padding: '12px 16px', borderRadius: 8, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase' }}>Business Type *</label>
                  <select 
                    value={genForm.businessType} onChange={e => setGenForm({...genForm, businessType: e.target.value})}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: '#fff', padding: '12px 16px', borderRadius: 8, outline: 'none' }}
                  >
                    <option value="LocalBusiness" style={{color: '#000'}}>LocalBusiness</option>
                    <option value="Organization" style={{color: '#000'}}>Organization</option>
                    <option value="MedicalBusiness" style={{color: '#000'}}>MedicalBusiness</option>
                    <option value="LegalService" style={{color: '#000'}}>LegalService</option>
                    <option value="HomeAndConstructionBusiness" style={{color: '#000'}}>HomeAndConstructionBusiness</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase' }}>Website URL</label>
                  <input 
                    type="text" value={genForm.website} onChange={e => setGenForm({...genForm, website: e.target.value})}
                    placeholder="https://www.example.com"
                    style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: '#fff', padding: '12px 16px', borderRadius: 8, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase' }}>Services & Description</label>
                  <textarea 
                    value={genForm.description} onChange={e => setGenForm({...genForm, description: e.target.value})}
                    placeholder="Describe the main services, service areas, and specialties..."
                    style={{ width: '100%', minHeight: 120, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: '#fff', padding: '12px 16px', borderRadius: 8, outline: 'none', resize: 'vertical' }}
                  />
                </div>
                <button 
                  onClick={handleGenerate}
                  disabled={generating || !genForm.businessName}
                  style={{ background: `linear-gradient(135deg, ${C.accent}, #ea580c)`, color: '#fff', border: 'none', padding: '14px', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: (generating || !genForm.businessName) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (generating || !genForm.businessName) ? 0.7 : 1, marginTop: 10 }}
                >
                  {generating ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
                  {generating ? 'AI is Generating Schema...' : 'Generate Magic Schema'}
                </button>
              </div>
            </div>

            {/* AI Output JSON-LD */}
            <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Code size={18} color="#38bdf8" /> AI Output JSON-LD
                </h3>
                {generatedSchema && (
                  <button 
                    onClick={handleSaveGenerated}
                    style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)', padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Save to Library
                  </button>
                )}
              </div>
              <div style={{ flex: 1, padding: 24, overflowY: 'auto', background: '#0f172a' }}>
                {generatedSchema ? (
                  <pre style={{ margin: 0, color: '#38bdf8', fontSize: 13, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {JSON.stringify(generatedSchema, null, 2)}
                  </pre>
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
                    <FileJson size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
                    <p>Waiting for generation...</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 30, flex: 1, minHeight: 0 }}>
            {/* Interactive Builder Form Panel */}
            <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 30, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, marginTop: 0 }}>Select the type of markup you want to create:</label>
                  <select
                    value={builderType}
                    onChange={e => setBuilderType(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="" style={{ color: '#000' }}>Choose the correct Schema</option>
                    <option value="business" style={{ color: '#000' }}>Local Business</option>
                    <option value="person" style={{ color: '#000' }}>Person</option>
                    <option value="product" style={{ color: '#000' }}>Product</option>
                    <option value="event" style={{ color: '#000' }}>Event</option>
                    <option value="organization" style={{ color: '#000' }}>Organization</option>
                    <option value="website" style={{ color: '#000' }}>Website</option>
                  </select>
                </div>
                {builderType && (
                  <button
                    onClick={handleFillDemo}
                    style={{
                      background: 'rgba(249, 115, 22, 0.1)',
                      color: C.accent,
                      border: `1px solid rgba(249, 115, 22, 0.3)`,
                      padding: '0 20px',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      height: '46px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap',
                      transition: 'all 0.2s'
                    }}
                  >
                    ✨ Fill Demo
                  </button>
                )}
              </div>

              {builderType && sopGuides[builderType] && (
                <div style={{ background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.15)', borderRadius: 8, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#3b82f6', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                    <AlertCircle size={16} />
                    <span>{sopGuides[builderType].title}</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4, marginBottom: 8 }}>{sopGuides[builderType].desc}</p>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: '#cbd5e1', lineHeight: 1.5 }}>
                    {sopGuides[builderType].points.map((p, idx) => (
                      <li key={idx}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {builderType === '' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.muted, padding: 40, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
                  <FileJson size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
                  <p style={{ textAlign: 'center', fontSize: 14 }}>Please select a schema type from the dropdown above to start building structured markup.</p>
                </div>
              )}

              {builderType === 'business' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Select Local Business Type:</label>
                    <select
                      value={builderFields.businessType}
                      onChange={e => setBuilderFields({ ...builderFields, businessType: e.target.value })}
                      style={inputStyle}
                    >
                      {localBusinessTypes.map((item, idx) => {
                        if (item.items) {
                          return (
                            <optgroup key={idx} label={item.label} style={{ color: '#000' }}>
                              {item.items.map((sub, sidx) => (
                                <option key={sidx} value={sub.value} style={{ color: '#000' }}>
                                  {sub.label}
                                </option>
                              ))}
                            </optgroup>
                          );
                        }
                        return (
                          <option key={idx} value={item.value} style={{ color: '#000' }}>
                            {item.label}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label style={labelStyle}>Name:</label>
                    <input
                      type="text"
                      value={builderFields.name}
                      onChange={e => setBuilderFields({ ...builderFields, name: e.target.value })}
                      placeholder="e.g. Animal Shelter Name"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>URL:</label>
                    <input
                      type="text"
                      value={builderFields.url}
                      onChange={e => setBuilderFields({ ...builderFields, url: e.target.value })}
                      placeholder="e.g. https://www.example.com"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Extra URL:</label>
                    {extraLinks.map((link, idx) => (
                      <input
                        key={idx}
                        type="text"
                        value={link}
                        onChange={e => handleLinkChange(idx, e.target.value)}
                        placeholder="https://..."
                        style={{ ...inputStyle, marginBottom: 8 }}
                      />
                    ))}
                    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                      <button
                        onClick={handleAddLink}
                        style={{
                          background: 'rgba(59, 130, 246, 0.1)',
                          color: '#3b82f6',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          padding: '6px 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600
                        }}
                      >
                        Add Another Link
                      </button>
                      {extraLinks.length > 1 && (
                        <button
                          onClick={handleRemoveLink}
                          style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: '#ef4444',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            padding: '6px 12px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600
                          }}
                        >
                          Remove Last Link
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>Logo (use a URL to your logo image):</label>
                    <input
                      type="text"
                      value={builderFields.logo}
                      onChange={e => setBuilderFields({ ...builderFields, logo: e.target.value })}
                      placeholder="e.g. https://www.example.com/logo.png"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Image (use a URL to an image of your business):</label>
                    <input
                      type="text"
                      value={builderFields.image}
                      onChange={e => setBuilderFields({ ...builderFields, image: e.target.value })}
                      placeholder="e.g. https://www.example.com/storefront.jpg"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Description:</label>
                    <textarea
                      value={builderFields.description}
                      onChange={e => setBuilderFields({ ...builderFields, description: e.target.value })}
                      placeholder="Describe your business..."
                      style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                    />
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>Postal Address</h4>
                    <div>
                      <label style={labelStyle}>Address:</label>
                      <input
                        type="text"
                        value={builderFields.streetAddress}
                        onChange={e => setBuilderFields({ ...builderFields, streetAddress: e.target.value })}
                        placeholder="e.g. 123 Main St"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>City:</label>
                      <input
                        type="text"
                        value={builderFields.city}
                        onChange={e => setBuilderFields({ ...builderFields, city: e.target.value })}
                        placeholder="e.g. Metropolis"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>State/Region:</label>
                      <input
                        type="text"
                        value={builderFields.state}
                        onChange={e => setBuilderFields({ ...builderFields, state: e.target.value })}
                        placeholder="e.g. NY"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Zip/Postal Code:</label>
                      <input
                        type="text"
                        value={builderFields.postalCode}
                        onChange={e => setBuilderFields({ ...builderFields, postalCode: e.target.value })}
                        placeholder="e.g. 10001"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Country:</label>
                      <input
                        type="text"
                        value={builderFields.country}
                        onChange={e => setBuilderFields({ ...builderFields, country: e.target.value })}
                        placeholder="e.g. US"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>Include Lat/Long coordinates for better location</h4>
                    <div>
                      <label style={labelStyle}>Latitude:</label>
                      <input
                        type="text"
                        value={builderFields.latitude}
                        onChange={e => setBuilderFields({ ...builderFields, latitude: e.target.value })}
                        placeholder="e.g. 40.7128"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Longitude:</label>
                      <input
                        type="text"
                        value={builderFields.longitude}
                        onChange={e => setBuilderFields({ ...builderFields, longitude: e.target.value })}
                        placeholder="e.g. -74.0060"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Include a Map:</label>
                      <input
                        type="text"
                        value={builderFields.hasMap}
                        onChange={e => setBuilderFields({ ...builderFields, hasMap: e.target.value })}
                        placeholder="e.g. https://maps.google.com/?cid=..."
                        style={inputStyle}
                      />
                      <span style={{ fontSize: 11, color: C.muted, marginTop: 4, display: 'block' }}>Enter a Google Maps URL pointing to your business.</span>
                    </div>
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>Business Hours</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {Object.keys(businessHours).map(day => {
                        const bh = businessHours[day];
                        return (
                          <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'rgba(255,255,255,0.01)', borderRadius: 6, border: `1px solid ${bh.checked ? 'rgba(249, 115, 22, 0.2)' : 'transparent'}` }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                              <input
                                type="checkbox"
                                checked={bh.checked}
                                onChange={() => handleHourToggle(day)}
                              />
                              <span>{day}</span>
                            </label>
                            {bh.checked && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 22, marginTop: 4 }}>
                                <span style={{ fontSize: 12, color: C.muted }}>Open:</span>
                                <select
                                  value={bh.open}
                                  onChange={e => handleHourChange(day, 'open', e.target.value)}
                                  style={{ ...inputStyle, width: 'auto', marginTop: 0, padding: '4px 8px' }}
                                >
                                  {timeOptions.map(t => (
                                    <option key={t} value={t} style={{ color: '#000' }}>{t}</option>
                                  ))}
                                </select>
                                <span style={{ fontSize: 12, color: C.muted }}>Close:</span>
                                <select
                                  value={bh.close}
                                  onChange={e => handleHourChange(day, 'close', e.target.value)}
                                  style={{ ...inputStyle, width: 'auto', marginTop: 0, padding: '4px 8px' }}
                                >
                                  {timeOptions.map(t => (
                                    <option key={t} value={t} style={{ color: '#000' }}>{t}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>Contact Details</h4>
                    <div>
                      <label style={labelStyle}>Telephone:</label>
                      <input
                        type="text"
                        value={builderFields.phone}
                        onChange={e => setBuilderFields({ ...builderFields, phone: e.target.value })}
                        placeholder="+1(XXX) XXX-XXXX"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Contact Type:</label>
                      <input
                        type="text"
                        value={builderFields.contactType}
                        onChange={e => setBuilderFields({ ...builderFields, contactType: e.target.value })}
                        placeholder="e.g. customer service"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </div>
              )}

              {builderType === 'person' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Name:</label>
                    <input
                      type="text"
                      value={builderFields.name}
                      onChange={e => setBuilderFields({ ...builderFields, name: e.target.value })}
                      placeholder="e.g. John Doe"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Job Title:</label>
                    <input
                      type="text"
                      value={builderFields.jobTitle}
                      onChange={e => setBuilderFields({ ...builderFields, jobTitle: e.target.value })}
                      placeholder="e.g. Software Engineer"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>URL:</label>
                    <input
                      type="text"
                      value={builderFields.url}
                      onChange={e => setBuilderFields({ ...builderFields, url: e.target.value })}
                      placeholder="e.g. https://johndoe.com"
                      style={inputStyle}
                    />
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>Address</h4>
                    <div>
                      <label style={labelStyle}>Address:</label>
                      <input
                        type="text"
                        value={builderFields.streetAddress}
                        onChange={e => setBuilderFields({ ...builderFields, streetAddress: e.target.value })}
                        placeholder="e.g. 123 Main St"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>PO Box:</label>
                      <input
                        type="text"
                        value={builderFields.poBox}
                        onChange={e => setBuilderFields({ ...builderFields, poBox: e.target.value })}
                        placeholder="e.g. PO Box 456"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>City:</label>
                      <input
                        type="text"
                        value={builderFields.city}
                        onChange={e => setBuilderFields({ ...builderFields, city: e.target.value })}
                        placeholder="e.g. Metropolis"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>State/Region:</label>
                      <input
                        type="text"
                        value={builderFields.state}
                        onChange={e => setBuilderFields({ ...builderFields, state: e.target.value })}
                        placeholder="e.g. NY"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Zip/Postal Code:</label>
                      <input
                        type="text"
                        value={builderFields.postalCode}
                        onChange={e => setBuilderFields({ ...builderFields, postalCode: e.target.value })}
                        placeholder="e.g. 10001"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Country:</label>
                      <input
                        type="text"
                        value={builderFields.country}
                        onChange={e => setBuilderFields({ ...builderFields, country: e.target.value })}
                        placeholder="e.g. US"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>Contact details</h4>
                    <div>
                      <label style={labelStyle}>Email:</label>
                      <input
                        type="email"
                        value={builderFields.email}
                        onChange={e => setBuilderFields({ ...builderFields, email: e.target.value })}
                        placeholder="e.g. john@example.com"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Telephone (please include country code, +1 for USA):</label>
                      <input
                        type="text"
                        value={builderFields.phone}
                        onChange={e => setBuilderFields({ ...builderFields, phone: e.target.value })}
                        placeholder="+1(XXX) XXX-XXXX"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Birth Date (international format YYYY-MM-DD):</label>
                      <input
                        type="text"
                        value={builderFields.birthDate}
                        onChange={e => setBuilderFields({ ...builderFields, birthDate: e.target.value })}
                        placeholder="e.g. 1990-01-01"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </div>
              )}

              {builderType === 'product' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Brand:</label>
                    <input
                      type="text"
                      value={builderFields.brand}
                      onChange={e => setBuilderFields({ ...builderFields, brand: e.target.value })}
                      placeholder="e.g. Brand Name"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Name:</label>
                    <input
                      type="text"
                      value={builderFields.name}
                      onChange={e => setBuilderFields({ ...builderFields, name: e.target.value })}
                      placeholder="e.g. Product Name"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Image (relative or absolute url):</label>
                    <input
                      type="text"
                      value={builderFields.image}
                      onChange={e => setBuilderFields({ ...builderFields, image: e.target.value })}
                      placeholder="e.g. https://www.example.com/product.jpg"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Description:</label>
                    <textarea
                      value={builderFields.description}
                      onChange={e => setBuilderFields({ ...builderFields, description: e.target.value })}
                      placeholder="Describe the product..."
                      style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Rating:</label>
                    <input
                      type="text"
                      value={builderFields.rating}
                      onChange={e => setBuilderFields({ ...builderFields, rating: e.target.value })}
                      placeholder="e.g. 4.5"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Based on how many reviews?</label>
                    <input
                      type="text"
                      value={builderFields.reviews}
                      onChange={e => setBuilderFields({ ...builderFields, reviews: e.target.value })}
                      placeholder="e.g. 24"
                      style={inputStyle}
                    />
                  </div>
                </div>
              )}

              {builderType === 'event' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Select Event Type</label>
                    <select
                      value={builderFields.eventType}
                      onChange={e => setBuilderFields({ ...builderFields, eventType: e.target.value })}
                      style={inputStyle}
                    >
                      {eventTypes.map(et => (
                        <option key={et.value} value={et.value} style={{ color: '#000' }}>
                          {et.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Name:</label>
                    <input
                      type="text"
                      value={builderFields.name}
                      onChange={e => setBuilderFields({ ...builderFields, name: e.target.value })}
                      placeholder="e.g. Event Name"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>URL:</label>
                    <input
                      type="text"
                      value={builderFields.url}
                      onChange={e => setBuilderFields({ ...builderFields, url: e.target.value })}
                      placeholder="e.g. https://www.example.com/event"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Description:</label>
                    <textarea
                      value={builderFields.description}
                      onChange={e => setBuilderFields({ ...builderFields, description: e.target.value })}
                      placeholder="Describe the event..."
                      style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Start Date:</label>
                    <input
                      type="datetime-local"
                      value={builderFields.startDate}
                      onChange={e => setBuilderFields({ ...builderFields, startDate: e.target.value })}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>End Date:</label>
                    <input
                      type="datetime-local"
                      value={builderFields.endDate}
                      onChange={e => setBuilderFields({ ...builderFields, endDate: e.target.value })}
                      style={inputStyle}
                    />
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>Venue Information</h4>
                    <div>
                      <label style={labelStyle}>Venue Name:</label>
                      <input
                        type="text"
                        value={builderFields.locationName}
                        onChange={e => setBuilderFields({ ...builderFields, locationName: e.target.value })}
                        placeholder="e.g. Madison Square Garden"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Venue URL:</label>
                      <input
                        type="text"
                        value={builderFields.locationURL}
                        onChange={e => setBuilderFields({ ...builderFields, locationURL: e.target.value })}
                        placeholder="e.g. https://www.msg.com"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Address:</label>
                      <input
                        type="text"
                        value={builderFields.streetAddress}
                        onChange={e => setBuilderFields({ ...builderFields, streetAddress: e.target.value })}
                        placeholder="e.g. 4 Pennsylvania Plaza"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>City:</label>
                      <input
                        type="text"
                        value={builderFields.city}
                        onChange={e => setBuilderFields({ ...builderFields, city: e.target.value })}
                        placeholder="e.g. New York"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>State/Region:</label>
                      <input
                        type="text"
                        value={builderFields.state}
                        onChange={e => setBuilderFields({ ...builderFields, state: e.target.value })}
                        placeholder="e.g. NY"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Zip/Postal Code:</label>
                      <input
                        type="text"
                        value={builderFields.postalCode}
                        onChange={e => setBuilderFields({ ...builderFields, postalCode: e.target.value })}
                        placeholder="e.g. 10001"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Country:</label>
                      <input
                        type="text"
                        value={builderFields.country}
                        onChange={e => setBuilderFields({ ...builderFields, country: e.target.value })}
                        placeholder="e.g. US"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>Offer / Ticket Details</h4>
                    <div>
                      <label style={labelStyle}>Offer Description:</label>
                      <input
                        type="text"
                        value={builderFields.offerDesc}
                        onChange={e => setBuilderFields({ ...builderFields, offerDesc: e.target.value })}
                        placeholder="e.g. General Admission"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Offer URL:</label>
                      <input
                        type="text"
                        value={builderFields.offerURL}
                        onChange={e => setBuilderFields({ ...builderFields, offerURL: e.target.value })}
                        placeholder="e.g. https://www.example.com/tickets"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Offer Price:</label>
                      <input
                        type="text"
                        value={builderFields.offerPrice}
                        onChange={e => setBuilderFields({ ...builderFields, offerPrice: e.target.value })}
                        placeholder="e.g. 49.99"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </div>
              )}

              {builderType === 'organization' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Select Organization Type:</label>
                    <select
                      value={builderFields.orgType}
                      onChange={e => setBuilderFields({ ...builderFields, orgType: e.target.value })}
                      style={inputStyle}
                    >
                      {organizationTypes.map(ot => (
                        <option key={ot.value} value={ot.value} style={{ color: '#000' }}>
                          {ot.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Name:</label>
                    <input
                      type="text"
                      value={builderFields.name}
                      onChange={e => setBuilderFields({ ...builderFields, name: e.target.value })}
                      placeholder="e.g. Organization Name"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>URL:</label>
                    <input
                      type="text"
                      value={builderFields.url}
                      onChange={e => setBuilderFields({ ...builderFields, url: e.target.value })}
                      placeholder="e.g. https://www.example.com"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Extra URL:</label>
                    {extraLinks.map((link, idx) => (
                      <input
                        key={idx}
                        type="text"
                        value={link}
                        onChange={e => handleLinkChange(idx, e.target.value)}
                        placeholder="https://..."
                        style={{ ...inputStyle, marginBottom: 8 }}
                      />
                    ))}
                    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                      <button
                        onClick={handleAddLink}
                        style={{
                          background: 'rgba(59, 130, 246, 0.1)',
                          color: '#3b82f6',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          padding: '6px 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600
                        }}
                      >
                        Add Another Link
                      </button>
                      {extraLinks.length > 1 && (
                        <button
                          onClick={handleRemoveLink}
                          style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: '#ef4444',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            padding: '6px 12px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600
                          }}
                        >
                          Remove Last Link
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Logo (use a URL to your logo image):</label>
                    <input
                      type="text"
                      value={builderFields.logo}
                      onChange={e => setBuilderFields({ ...builderFields, logo: e.target.value })}
                      placeholder="e.g. https://www.example.com/logo.png"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Image (use a URL to your an image of your business):</label>
                    <input
                      type="text"
                      value={builderFields.image}
                      onChange={e => setBuilderFields({ ...builderFields, image: e.target.value })}
                      placeholder="e.g. https://www.example.com/photo.jpg"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Description:</label>
                    <textarea
                      value={builderFields.description}
                      onChange={e => setBuilderFields({ ...builderFields, description: e.target.value })}
                      placeholder="Describe the organization..."
                      style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                    />
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>Address</h4>
                    <div>
                      <label style={labelStyle}>Address:</label>
                      <input
                        type="text"
                        value={builderFields.streetAddress}
                        onChange={e => setBuilderFields({ ...builderFields, streetAddress: e.target.value })}
                        placeholder="e.g. 123 Main St"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>PO Box:</label>
                      <input
                        type="text"
                        value={builderFields.poBox}
                        onChange={e => setBuilderFields({ ...builderFields, poBox: e.target.value })}
                        placeholder="e.g. PO Box 789"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>City:</label>
                      <input
                        type="text"
                        value={builderFields.city}
                        onChange={e => setBuilderFields({ ...builderFields, city: e.target.value })}
                        placeholder="e.g. Metropolis"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>State/Region:</label>
                      <input
                        type="text"
                        value={builderFields.state}
                        onChange={e => setBuilderFields({ ...builderFields, state: e.target.value })}
                        placeholder="e.g. NY"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Zip/Postal Code:</label>
                      <input
                        type="text"
                        value={builderFields.postalCode}
                        onChange={e => setBuilderFields({ ...builderFields, postalCode: e.target.value })}
                        placeholder="e.g. 10001"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Country:</label>
                      <input
                        type="text"
                        value={builderFields.country}
                        onChange={e => setBuilderFields({ ...builderFields, country: e.target.value })}
                        placeholder="e.g. US"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>Include Lat/Long coordinates for better location</h4>
                    <div>
                      <label style={labelStyle}>Latitude:</label>
                      <input
                        type="text"
                        value={builderFields.latitude}
                        onChange={e => setBuilderFields({ ...builderFields, latitude: e.target.value })}
                        placeholder="e.g. 40.7128"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Longitude:</label>
                      <input
                        type="text"
                        value={builderFields.longitude}
                        onChange={e => setBuilderFields({ ...builderFields, longitude: e.target.value })}
                        placeholder="e.g. -74.0060"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Include a Map:</label>
                      <input
                        type="text"
                        value={builderFields.hasMap}
                        onChange={e => setBuilderFields({ ...builderFields, hasMap: e.target.value })}
                        placeholder="e.g. https://maps.google.com/?cid=..."
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>Business Hours</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {Object.keys(businessHours).map(day => {
                        const bh = businessHours[day];
                        return (
                          <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'rgba(255,255,255,0.01)', borderRadius: 6, border: `1px solid ${bh.checked ? 'rgba(249, 115, 22, 0.2)' : 'transparent'}` }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                              <input
                                type="checkbox"
                                checked={bh.checked}
                                onChange={() => handleHourToggle(day)}
                              />
                              <span>{day}</span>
                            </label>
                            {bh.checked && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 22, marginTop: 4 }}>
                                <span style={{ fontSize: 12, color: C.muted }}>Open:</span>
                                <select
                                  value={bh.open}
                                  onChange={e => handleHourChange(day, 'open', e.target.value)}
                                  style={{ ...inputStyle, width: 'auto', marginTop: 0, padding: '4px 8px' }}
                                >
                                  {timeOptions.map(t => (
                                    <option key={t} value={t} style={{ color: '#000' }}>{t}</option>
                                  ))}
                                </select>
                                <span style={{ fontSize: 12, color: C.muted }}>Close:</span>
                                <select
                                  value={bh.close}
                                  onChange={e => handleHourChange(day, 'close', e.target.value)}
                                  style={{ ...inputStyle, width: 'auto', marginTop: 0, padding: '4px 8px' }}
                                >
                                  {timeOptions.map(t => (
                                    <option key={t} value={t} style={{ color: '#000' }}>{t}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>Contact Details</h4>
                    <div>
                      <label style={labelStyle}>Telephone:</label>
                      <input
                        type="text"
                        value={builderFields.phone}
                        onChange={e => setBuilderFields({ ...builderFields, phone: e.target.value })}
                        placeholder="+1(XXX) XXX-XXXX"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Contact Type:</label>
                      <input
                        type="text"
                        value={builderFields.contactType}
                        onChange={e => setBuilderFields({ ...builderFields, contactType: e.target.value })}
                        placeholder="e.g. customer service"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </div>
              )}

              {builderType === 'website' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Name:</label>
                    <input
                      type="text"
                      value={builderFields.name}
                      onChange={e => setBuilderFields({ ...builderFields, name: e.target.value })}
                      placeholder="e.g. My Website"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Alternate Name:</label>
                    <input
                      type="text"
                      value={builderFields.alternateName}
                      onChange={e => setBuilderFields({ ...builderFields, alternateName: e.target.value })}
                      placeholder="e.g. My Web"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>URL:</label>
                    <input
                      type="text"
                      value={builderFields.url}
                      onChange={e => setBuilderFields({ ...builderFields, url: e.target.value })}
                      placeholder="e.g. https://www.example.com"
                      style={inputStyle}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Real-time Code Output Panel */}
            <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Code size={18} color="#38bdf8" /> Compiled JSON-LD
                </h3>
                {compiledJson && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={handleResetBuilder}
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        color: '#ef4444',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Reset Form
                    </button>
                    <button
                      onClick={() => handleCopyBuilderCode(compiledCodeString)}
                      style={{
                        background: copiedBuilderCode ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
                        color: copiedBuilderCode ? '#22c55e' : '#e2e8f0',
                        border: `1px solid ${copiedBuilderCode ? '#22c55e' : C.border}`,
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      {copiedBuilderCode ? 'Copied ✓' : 'Copy Code'}
                    </button>
                    <button
                      onClick={handleSaveBuilder}
                      style={{
                        background: 'rgba(34, 197, 94, 0.1)',
                        color: '#22c55e',
                        border: '1px solid rgba(34, 197, 94, 0.3)',
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Save to Library
                    </button>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, padding: 24, overflowY: 'auto', background: '#0f172a' }}>
                {compiledCodeString ? (
                  <pre style={{ margin: 0, color: '#38bdf8', fontSize: 13, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {compiledCodeString}
                  </pre>
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
                    <FileJson size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
                    <p>Enter details on the left to compile schema...</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderEntities = () => (
    <div style={{ display: 'flex', gap: 30, height: 'calc(100vh - 200px)' }}>
      {/* Left side: Form */}
      <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 30, overflowY: 'auto' }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Network size={18} color={C.accent} /> Knowledge Graph Entities
        </h3>
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
          Strengthen your Google Knowledge Panel by explicitly mapping your primary business entity to known high-authority profiles (Wikipedia, Crunchbase, Social Media).
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {entityLinks.map((link, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <select 
                value={link.type}
                onChange={e => {
                  const arr = [...entityLinks];
                  arr[idx].type = e.target.value;
                  setEntityLinks(arr);
                }}
                style={{ width: 140, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px', borderRadius: 8, outline: 'none' }}
              >
                <option style={{color:'#000'}} value="Wikipedia">Wikipedia</option>
                <option style={{color:'#000'}} value="Wikidata">Wikidata</option>
                <option style={{color:'#000'}} value="Crunchbase">Crunchbase</option>
                <option style={{color:'#000'}} value="LinkedIn">LinkedIn</option>
                <option style={{color:'#000'}} value="Twitter">Twitter</option>
                <option style={{color:'#000'}} value="Facebook">Facebook</option>
                <option style={{color:'#000'}} value="Instagram">Instagram</option>
              </select>
              <input 
                type="text" 
                value={link.url}
                onChange={e => {
                  const arr = [...entityLinks];
                  arr[idx].url = e.target.value;
                  setEntityLinks(arr);
                }}
                placeholder="https://"
                style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 14px', borderRadius: 8, outline: 'none' }}
              />
              <button 
                onClick={() => setEntityLinks(entityLinks.filter((_, i) => i !== idx))}
                style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 8 }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, paddingTop: 16, borderTop: `1px dashed ${C.border}` }}>
            <select 
              value={newLink.type}
              onChange={e => setNewLink({...newLink, type: e.target.value})}
              style={{ width: 140, background: 'rgba(255,255,255,0.03)', border: `1px dashed ${C.border}`, color: '#fff', padding: '10px', borderRadius: 8, outline: 'none' }}
            >
                <option style={{color:'#000'}} value="Wikipedia">Wikipedia</option>
                <option style={{color:'#000'}} value="Wikidata">Wikidata</option>
                <option style={{color:'#000'}} value="Crunchbase">Crunchbase</option>
                <option style={{color:'#000'}} value="LinkedIn">LinkedIn</option>
                <option style={{color:'#000'}} value="Twitter">Twitter</option>
                <option style={{color:'#000'}} value="Facebook">Facebook</option>
                <option style={{color:'#000'}} value="Instagram">Instagram</option>
            </select>
            <input 
              type="text" 
              value={newLink.url}
              onChange={e => setNewLink({...newLink, url: e.target.value})}
              placeholder="Add new entity URL..."
              style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: `1px dashed ${C.border}`, color: '#fff', padding: '10px 14px', borderRadius: 8, outline: 'none' }}
            />
            <button 
              onClick={() => {
                if(newLink.url) {
                  setEntityLinks([...entityLinks, newLink]);
                  setNewLink({ type: 'Twitter', url: '' });
                }
              }}
              style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#3b82f6', cursor: 'pointer', padding: '10px', borderRadius: 8, display: 'flex', alignItems: 'center' }}
            >
              <Plus size={16} />
            </button>
          </div>

          <button 
            onClick={async () => {
              setUpdatingGraph(true);
              try {
                await api.put('/thedal/schemalibrary/entities', { entities: entityLinks });
                setUpdateGraphModalOpen(true);
              } catch (err) {
                alert("Failed to update graph: " + err.message);
              } finally {
                setUpdatingGraph(false);
              }
            }}
            disabled={updatingGraph}
            style={{ background: C.accent, color: '#fff', border: 'none', padding: '14px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: updatingGraph ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24, opacity: updatingGraph ? 0.7 : 1 }}
          >
            {updatingGraph ? <Loader2 size={16} className="spin" /> : <Network size={16} />}
            {updatingGraph ? 'Updating Knowledge Graph...' : 'Update Knowledge Graph Mapping'}
          </button>
        </div>
      </div>

      {/* Right side: Graph Visualizer */}
      <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.02)' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Network size={18} color="#8b5cf6" /> Live Graph Visualization
          </h3>
        </div>
        <div style={{ flex: 1, padding: 40, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.05, backgroundImage: 'radial-gradient(#38bdf8 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 60, position: 'relative', zIndex: 10, width: '100%', maxWidth: 500 }}>
            {/* Core Entity */}
            <div style={{ background: 'rgba(234, 88, 12, 0.1)', border: '2px solid #ea580c', padding: '20px', borderRadius: '50%', width: 120, height: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 30px rgba(234, 88, 12, 0.2)', zIndex: 2 }}>
              <Globe size={32} color="#ea580c" style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center' }}>Primary Entity</div>
            </div>

            {/* Connector Lines & Nodes */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20, position: 'relative' }}>
              {(showAllEntities ? entityLinks : entityLinks.slice(0, 8)).map((link, idx) => (
                <div key={idx} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <div style={{ position: 'absolute', left: -60, width: 60, height: 2, background: 'rgba(139, 92, 246, 0.3)' }}></div>
                  <div style={{ background: 'rgba(139, 92, 246, 0.1)', border: '1px solid #8b5cf6', padding: '12px 16px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, width: '100%', boxShadow: '0 0 15px rgba(139, 92, 246, 0.1)' }}>
                    <div style={{ background: '#8b5cf6', width: 8, height: 8, borderRadius: '50%' }}></div>
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{link.type}</div>
                      <div style={{ fontSize: 11, color: C.muted, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.url}</div>
                    </div>
                  </div>
                </div>
              ))}
              {entityLinks.length > 8 && (
                <button 
                  onClick={() => setShowAllEntities(!showAllEntities)}
                  style={{ background: 'rgba(139, 92, 246, 0.1)', border: '1px solid #8b5cf6', color: '#cbd5e1', cursor: 'pointer', padding: '8px 12px', borderRadius: 6, fontSize: 12, width: '100%', textAlign: 'center', fontWeight: 600, marginTop: 10 }}
                >
                  {showAllEntities ? 'Show Less (Limit to 8)' : `Show All (+${entityLinks.length - 8} more)`}
                </button>
              )}
              {entityLinks.length === 0 && (
                <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 20 }}>No external entities mapped.</div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );

  const renderDeployments = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
      <div style={{ display: 'flex', gap: 30 }}>
        <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 30 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Globe size={18} color={C.accent} /> Deployment Setup
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase' }}>1. Select Master Template</label>
              <select 
                value={deployForm.templateId} onChange={e => setDeployForm({...deployForm, templateId: e.target.value})}
                style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: '#fff', padding: '12px 16px', borderRadius: 8, outline: 'none' }}
              >
                <option value="" style={{color:'#000'}}>-- Select Template --</option>
                {data.map(t => (
                  <option key={t.id} value={t.id} style={{color:'#000'}}>{t.name} ({t.schema_type})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase' }}>2. Client Website URL</label>
              <input 
                type="text" value={deployForm.clientUrl} onChange={e => setDeployForm({...deployForm, clientUrl: e.target.value})}
                placeholder="https://www.client-website.com"
                style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: '#fff', padding: '12px 16px', borderRadius: 8, outline: 'none' }}
              />
            </div>

            <div style={{ background: 'rgba(234, 88, 12, 0.1)', border: '1px dashed #ea580c', borderRadius: 8, padding: 16, marginTop: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ea580c', marginBottom: 4 }}>Entity Graph Injection</div>
              <div style={{ fontSize: 12, color: C.muted }}>
                When compiled, {entityLinks.length} mapped entities will automatically be injected into the `sameAs` property.
              </div>
            </div>

            <button 
              onClick={generateDeployment}
              style={{ background: `linear-gradient(135deg, ${C.accent}, #ea580c)`, color: '#fff', border: 'none', padding: '14px', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}
            >
              <Code size={18} /> Compile Deployment Code
            </button>
          </div>
        </div>

        <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 350 }}>
          <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Code size={18} color="#38bdf8" /> Compiled Tag
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {deploymentScript && (
                <button 
                  onClick={handleCopyCode}
                  style={{ background: copied ? 'rgba(34, 197, 94, 0.1)' : 'transparent', color: copied ? '#22c55e' : '#e2e8f0', border: `1px solid ${copied ? '#22c55e' : C.border}`, padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  {copied ? 'Copied ✓' : 'Copy to GTM'}
                </button>
              )}
              {deploymentScript && (
                <button 
                  onClick={handlePushDeploy}
                  disabled={deploying}
                  style={{ background: '#22c55e', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: deploying ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: deploying ? 0.7 : 1 }}
                >
                  {deploying ? <Loader2 size={12} className="spin" /> : <Globe size={12} />}
                  {deploying ? 'Pushing...' : 'Push to API'}
                </button>
              )}
            </div>
          </div>
          <div style={{ flex: 1, padding: 24, overflowY: 'auto', background: '#0f172a' }}>
            {deploymentScript ? (
              <pre style={{ margin: 0, color: '#38bdf8', fontSize: 13, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {deploymentScript}
              </pre>
            ) : (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
                <Globe size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
                <p>Configure and compile to view deployment tag.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Section: Deployment History Log */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Globe size={18} color={C.accent} /> Deployment History Log
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Client URL</th>
              <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Template Applied</th>
              <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Deployed At</th>
              <th style={{ padding: '12px 10px', color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {activeDeployments.length > 0 ? activeDeployments.map((dep, idx) => (
              <tr key={idx} style={{ borderBottom: `1px solid ${C.border}55` }}>
                <td style={{ padding: '16px 10px', fontSize: 14, color: '#38bdf8', fontWeight: 600 }}>{dep.clientUrl}</td>
                <td style={{ padding: '16px 10px', fontSize: 14, color: '#e2e8f0' }}>{dep.templateName || 'Unknown Template'}</td>
                <td style={{ padding: '16px 10px', fontSize: 13, color: '#94a3b8' }}>
                  {dep.deployedAt ? new Date(dep.deployedAt).toLocaleString() : 'Just now'}
                </td>
                <td style={{ padding: '16px 10px', textAlign: 'right' }}>
                  <span style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                    Live
                  </span>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={4} style={{ padding: '40px 0', textAlign: 'center', color: C.muted }}>No deployments found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderPlaceholder = (title, phase) => (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 60, textAlign: 'center' }}>
      <AlertCircle size={48} color={C.muted} style={{ marginBottom: 20, opacity: 0.5 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h2 style={{ fontSize: 24, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>{title}</h2><SopModal /></div>
      <p style={{ color: '#94a3b8', fontSize: 15, maxWidth: 500, margin: '0 auto' }}>
        This module is scheduled for development in <strong>{phase}</strong> of the Schema Library rollout plan.
      </p>
    </div>
  );

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
    { id: 'templates', label: 'Templates', icon: <Code size={16} /> },
    { id: 'generate', label: 'AI Generator', icon: <Sparkles size={16} /> },
    { id: 'entities', label: 'Entity Graph', icon: <Network size={16} /> },
    { id: 'deploy', label: 'Deployments', icon: <Globe size={16} /> },
  ];

  return (
    <div style={{ padding: 40, color: C.text, height: '100%', overflowY: 'auto', background: C.background }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: '#e2e8f0', margin: 0, fontFamily: "'Syne', sans-serif", display: 'flex', alignItems: 'center', gap: 12 }}>
            <FileJson size={28} color={C.accent} /> Schema Library
          </h1>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>
            Centralized Structured Data and Entity Management System.
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 30, borderBottom: `1px solid ${C.border}`, paddingBottom: 16 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              background: activeTab === t.id ? 'rgba(234, 88, 12, 0.1)' : 'transparent',
              color: activeTab === t.id ? C.accent : C.muted,
              border: `1px solid ${activeTab === t.id ? 'rgba(234, 88, 12, 0.3)' : 'transparent'}`,
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s'
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', height: 200, alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={32} color={C.accent} className="spin" />
        </div>
      ) : (
        <>
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'templates' && renderTemplates()}
          {activeTab === 'generate' && renderGenerator()}
          {activeTab === 'entities' && renderEntities()}
          {activeTab === 'deploy' && renderDeployments()}
        </>
      )}

      {/* Template Modal */}
      {modalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, width: '100%', maxWidth: 800, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
            
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 18, color: '#e2e8f0', fontWeight: 700 }}>
                {editingId ? 'Edit Schema Template' : 'Create Schema Template'}
              </h3>
            </div>

            <div style={{ padding: 24, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 2 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase' }}>Template Name *</label>
                  <input 
                    type="text" 
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    placeholder="e.g. Master LocalBusiness Schema"
                    style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 14px', borderRadius: 6, outline: 'none' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase' }}>Schema Type *</label>
                  <select 
                    value={formData.schema_type}
                    onChange={e => setFormData({...formData, schema_type: e.target.value})}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 14px', borderRadius: 6, outline: 'none' }}
                  >
                    <option value="LocalBusiness" style={{color: '#000'}}>LocalBusiness</option>
                    <option value="Organization" style={{color: '#000'}}>Organization</option>
                    <option value="FAQPage" style={{color: '#000'}}>FAQPage</option>
                    <option value="Article" style={{color: '#000'}}>Article</option>
                    <option value="Service" style={{color: '#000'}}>Service</option>
                    <option value="Review" style={{color: '#000'}}>Review</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase' }}>Description</label>
                <input 
                  type="text" 
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Optional description for this template"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 14px', borderRadius: 6, outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: 'uppercase' }}>JSON-LD Data *</label>
                  <button 
                    onClick={handleValidate} 
                    disabled={validating}
                    style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: validating ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    {validating ? <Loader2 size={12} className="spin" /> : <Network size={12} />}
                    {validating ? 'Validating...' : 'Validate against Google'}
                  </button>
                </div>
                
                {validationResult && (
                  <div style={{ marginBottom: 12, padding: 12, borderRadius: 6, border: `1px solid ${validationResult.isValid ? '#22c55e' : '#ef4444'}`, background: validationResult.isValid ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: validationResult.isValid ? '#22c55e' : '#ef4444', marginBottom: validationResult.errors?.length || validationResult.warnings?.length ? 8 : 0 }}>
                      {validationResult.isValid ? '✓ Schema is valid for Google Rich Results' : '⚠ Schema has errors'}
                    </div>
                    {validationResult.errors?.length > 0 && (
                      <ul style={{ margin: '0 0 8px 0', paddingLeft: 20, color: '#ef4444', fontSize: 12 }}>
                        {validationResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    )}
                    {validationResult.warnings?.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 20, color: '#eab308', fontSize: 12 }}>
                        {validationResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    )}
                  </div>
                )}

                <textarea 
                  value={formData.schema_data}
                  onChange={e => {
                    setFormData({...formData, schema_data: e.target.value});
                    setValidationResult(null); // Clear validation on edit
                  }}
                  style={{ 
                    width: '100%', flex: 1, minHeight: 250, background: '#0f172a', border: `1px solid ${C.border}`, 
                    color: '#38bdf8', padding: '14px', borderRadius: 6, outline: 'none', fontFamily: 'monospace', fontSize: 13, resize: 'vertical'
                  }}
                />
              </div>

            </div>

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 12, background: 'rgba(0,0,0,0.1)' }}>
              <button 
                onClick={() => setModalOpen(false)}
                style={{ background: 'transparent', color: '#e2e8f0', border: `1px solid ${C.border}`, padding: '8px 20px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button 
                onClick={handleSave}
                disabled={saving}
                style={{ background: C.accent, color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: saving ? 0.7 : 1 }}
              >
                {saving ? <Loader2 size={16} className="spin" /> : null}
                {saving ? 'Saving...' : 'Save Template'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 30, maxWidth: 400, width: '90%', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', textAlign: 'center' }}>
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
              <Trash2 size={32} color="#ef4444" />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: '0 0 12px 0' }}>Delete Template?</h3>
            <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.5, margin: '0 0 24px 0' }}>
              Are you sure you want to delete <strong>{templateToDelete?.name}</strong>? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
              <button 
                onClick={() => setDeleteModalOpen(false)}
                style={{ background: 'transparent', color: '#e2e8f0', border: `1px solid ${C.border}`, padding: '8px 20px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button 
                onClick={confirmDelete}
                style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Knowledge Graph Success Modal */}
      {updateGraphModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 30, maxWidth: 400, width: '90%', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', textAlign: 'center' }}>
            <div style={{ background: 'rgba(34, 197, 94, 0.1)', width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
              <Network size={32} color="#22c55e" />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: '0 0 12px 0' }}>Knowledge Graph Updated!</h3>
            <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.5, margin: '0 0 24px 0' }}>
              Successfully mapped <strong>{entityLinks.length}</strong> entities. The 'sameAs' attributes have been dynamically injected into your active schema deployments.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button 
                onClick={() => setUpdateGraphModalOpen(false)}
                style={{ background: '#22c55e', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Awesome
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
