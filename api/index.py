import os
import sys

# Make the project root importable so Django can find spotter_hos / hos_planner
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "spotter_hos.settings")

from django.core.wsgi import get_wsgi_application  # noqa: E402

app = get_wsgi_application()
