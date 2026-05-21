from django.urls import path
from . import views

urlpatterns = [
    path('hos-planner/', views.hos_planner, name='hos-planner'),
]
