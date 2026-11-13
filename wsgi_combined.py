import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "hashkao.settings")

from flask_app import create_app
from django.core.wsgi import get_wsgi_application
from werkzeug.middleware.dispatcher import DispatcherMiddleware

flask_app = create_app()
django_app = get_wsgi_application()

application = DispatcherMiddleware(django_app, {"/flask": flask_app})
