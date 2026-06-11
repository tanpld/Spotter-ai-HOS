Live demo: https://spotter-ai-hos.vercel.app/

What is Spotter HOS?
Spotter HOS is a trip planning tool for truck drivers that automatically figures out when they need to stop, rest, and refuel — all while staying within federal law.

The problem it solves
Truck drivers in the US are governed by strict federal rules called FMCSA Hours of Service (HOS) regulations. These rules exist for safety — tired drivers cause accidents. The rules limit things like:

A driver can only be behind the wheel for 11 hours per day
They can only be on duty for 14 hours total before they must rest
After 8 hours of driving, they must take a 30-minute break
They can only work 70 hours over 8 days before needing a full 34-hour restart
Trucks need to stop for fuel every 1,000 miles
Tracking all of this by hand is complicated and error-prone. Spotter HOS does it automatically.

How it works (from the user's perspective)
You enter 3 locations — where the driver is now, where they're picking up, and where they're dropping off
You enter how many hours the driver has already used this week
Click "Plan My Trip"
The app instantly calculates a full day-by-day schedule that follows all the rules
What you get back
A map showing the full route with all stops marked
Summary stats — total miles, total driving hours, how many days the trip takes
A day-by-day ELD log (ELD = Electronic Logging Device, the official record truck drivers must keep) showing exactly what the driver is doing each hour: driving, resting, on-duty, etc.
A warning if the driver's weekly hours are about to run out and they need a 34-hour restart before the trip
Under the hood (for a technical audience)
Backend: Python/Django API that runs the HOS calculation engine
Frontend: React app with an interactive map and timeline logs
All rules are enforced automatically — the algorithm builds the schedule so a driver never has to think about compliance
One-line pitch
"You give it a truck route, it gives you a legally compliant schedule — automatically."
