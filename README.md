# Lilai

A modern web application for managing event RSVPs with Google Calendar integration. This app allows attendees to RSVP to events while giving hosts visibility into expected attendance counts.

## Features

### Core Features
- 📅 **Google Calendar Integration** - Embed public Google Calendar to display events
- 📝 **RSVP Management** - Allow users to RSVP with attendance status (Yes/No/Maybe)

- 📊 **Attendance Dashboard** - Real-time attendance summary for event hosts
- 💬 **Comments Support** - Optional comments field for special requirements
- 📱 **Responsive Design** - Works seamlessly on desktop, tablet, and mobile

### Optional Features

- 🎨 **Modern UI/UX** - Clean, professional interface with smooth animations
- 💾 **File-based Storage** - No database required for quick setup


## Technology Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js, Express.js
- **Storage**: JSON file-based storage
- **Styling**: Custom CSS with responsive design
- **Calendar**: Google Calendar iframe integration

## Project Structure

```
lilai/
├── public/                 # Frontend assets
│   ├── index.html         # Main HTML file
│   ├── app.js            # Frontend JavaScript
│   └── styles.css        # CSS styling
├── server/               # Backend server
│   └── app.js           # Express.js server
├── config/              # Configuration files

├── data/                # Data storage (auto-generated)
│   ├── events.json      # Events data
│   └── rsvps.json       # RSVP responses
├── package.json         # Node.js dependencies
├── .env.example         # Environment variables template
└── README.md           # Project documentation
```

## Quick Start

### Prerequisites

- Node.js (version 14 or higher)
- npm or yarn package manager

### Installation

1. **Clone or download the project** (already done if you're reading this)

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Open your browser** and navigate to:
   ```
   http://localhost:3000
   ```

### Development Mode

For development with auto-restart:
```bash
npm run dev
```

## Google Calendar Setup

To integrate your Google Calendar:

1. **Make your calendar public**:
   - Open Google Calendar
   - Go to your calendar settings
   - Under "Access permissions", check "Make available to public"

2. **Get the embed URL**:
   - In calendar settings, go to "Integrate calendar"
   - Copy the "Public URL" or "Embed code"

3. **Add to the app**:
   - Open `config/app.json`
   - In the `calendar` object, update the `urls` array with your Google Calendar embed URLs.
     Example:
     ```json
     "calendar": {
       "urls": [
         "https://calendar.google.com/calendar/embed?src=yourcalendarid1@group.calendar.google.com&ctz=Europe%2FBrussels",
         "https://calendar.google.com/calendar/embed?src=yourcalendarid2@group.calendar.google.com&ctz=Europe%2FBrussels"
       ],
       "enabled": true
     }
     ```

## API Endpoints

The application provides RESTful API endpoints:

### Events
- `GET /api/events` - Get all events
- `GET /api/events/:id` - Get specific event
- `POST /api/events` - Create new event

### RSVPs
- `POST /api/rsvp` - Submit RSVP
- `GET /api/attendance-summary` - Get attendance summary for all events
- `GET /api/attendance-summary/:eventId` - Get attendance for specific event

### Health
- `GET /api/health` - Health check endpoint

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key configuration options:
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `GOOGLE_CALENDAR_API_KEY` - For advanced calendar integration


### Sample Events

The app comes with sample events pre-loaded. These will be replaced when you integrate your Google Calendar or add your own events via the API.

## Usage

### For Event Hosts

1. **Set up your calendar**: Follow the Google Calendar setup guide above
2. **Share the app URL** with your attendees
3. **Monitor RSVPs**: Check the attendance summary section for real-time updates
4. **Export data**: RSVP data is stored in `data/rsvps.json` for further processing

### For Attendees

1. **View events**: Browse upcoming events in the calendar and event list
2. **RSVP to events**: Click the RSVP button on any event
3. **Choose your response**: Select Yes, No, or Maybe
4. **Add your details**: Provide your name
5. **Add comments**: Include any special requirements or notes

## Deployment

### Local Production

1. Set `NODE_ENV=production` in your `.env` file
2. Run `npm start`

### Cloud Deployment

The app is ready for deployment to platforms like:
- Heroku
- Railway
- Render
- DigitalOcean App Platform
- AWS Elastic Beanstalk

Key considerations for production:
- Set up proper environment variables
- Configure HTTPS
- Set up process monitoring
- Consider database migration for scale
