#!/usr/bin/env python

import os
import glob
import arrow
import magic
import pyexiv2
import argparse
import logging
import re

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

DEFAULT_IMAGE_DIR = "images"
DEFAULT_UTC_OFFSET_HOURS = +8
parser = argparse.ArgumentParser()
parser.add_argument(
    "-d", "--directory", dest="directory",
    default=DEFAULT_IMAGE_DIR,
    help="Directory to search for .jpg/.jpeg files to update timestamp")
parser.add_argument(
    "-o", "--offset", dest="utc_offset",
    default=DEFAULT_UTC_OFFSET_HOURS,
    type=int,
    help="Timezone in hours from UTC (+8 = Singapore, +9 = Japan, etc)"
)
args = parser.parse_args()

regex_post_idx = re.compile(r"post_([0-9]+)")


def update_timestamp(file_path):
    date_dir = os.path.basename(os.path.dirname(file_path))
    basename = os.path.basename(file_path)
    tzinfo_str = "{:02d}:00".format(args.utc_offset)
    datetime = arrow.get(date_dir, "YYYY-MM-DD").replace(tzinfo=tzinfo_str).datetime
    guessed_file_type = magic.from_file(file_path)
    log.debug("  date = %s  file type = %s", datetime, guessed_file_type)

    if "JPEG" not in guessed_file_type:
        log.info("  Skipping because this is not a JPEG file...")
        return
    # m = re.search(regex_post_idx, file_path)
    # post_comment = ""
    # try:
    #     if m:
    #         log.info("Post idx = %s", m.group(0))
    #         post_idx = m.group(0)
    #         post_file_glob_path = os.path.join(
    #             os.path.dirname(file_path),
    #             "*{}*.text".format(post_idx)
    #         )
    #         post_comment = open(list(glob.glob(post_file_glob_path))[0]).read()
    #         post_comment = post_comment.replace("\n", " ")
    #         log.info(post_comment)
    # except Exception:
    #     log.warning("Failed to open post text file")

    try:
        metadata = pyexiv2.ImageMetadata(file_path)
        metadata.read()
        metadata["Exif.Image.DateTime"] = pyexiv2.ExifTag("Exif.Image.DateTime", datetime)
        # if post_comment:
        #     metadata["Exif.Photo.UserComment"] = pyexiv2.ExifTag("Exif.Photo.UserComment", post_comment)
        metadata.write()
    except Exception:
        log.exception("Could not update EXIF metadata")


for suffix in [".jpg", ".jpeg"]:
    file_list = list(sorted(glob.glob(os.path.join(args.directory, "**", "*.jpg"), recursive=True)))
    for idx, file_path in enumerate(file_list):
        log.info("Updating %s (%d/%d)", file_path, idx, len(file_list))
        update_timestamp(file_path)
