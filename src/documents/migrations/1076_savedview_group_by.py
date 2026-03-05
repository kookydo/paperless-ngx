from django.db import migrations
from django.db import models


class Migration(migrations.Migration):
    dependencies = [
        ("documents", "1075_workflowaction_order"),
    ]

    operations = [
        migrations.AddField(
            model_name="savedview",
            name="group_by",
            field=models.CharField(
                blank=True,
                choices=[
                    ("none", "None"),
                    ("storagePathFolders", "Storage path folders"),
                    ("storagePath", "Storage path"),
                    ("correspondent", "Correspondent"),
                    ("documentType", "Document type"),
                    ("createdYear", "Created year"),
                    ("createdMonth", "Created month"),
                ],
                max_length=128,
                null=True,
                verbose_name="View group by",
            ),
        ),
    ]
